#!/usr/bin/env python3
"""Register this consumer's demand INTO the shared gold database (assets.db).

assets.db is a shared resource. The producer owns supply (catalog / meta / tags /
groups); the consumer writes demand into two producer-owned tables so the curator
can query and reply to it in-band:

  usage     — which asset_ids we ship (the "don't de-curate this" signal).
  requests  — phrases gold lacks that we need (the curator sets fulfilled_by).

Schema, column ownership, and durability rules: docs/handoff-demand-tables.md.

My *authored* demand stays git-tracked in this repo — clips/clips.manifest.json
(in-use) and audio-requests.json (wants). This tool PUSHES those into the shared
tables (single writer per column, so no drift) and reads the producer's
fulfilled_by replies back. It never writes fulfilled_by (the producer owns it).

  python3 scripts/register_demand.py            # push usage + requests, report
  python3 scripts/register_demand.py --dry-run  # show changes, write nothing
  python3 scripts/register_demand.py --check     # non-zero on READY/STALE (CI)
  CLIP_SOURCE=/path/to/MR_AudioClips python3 scripts/register_demand.py
"""
import json, os, sys, sqlite3
from datetime import datetime, timezone

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(APP, 'audio-requests.json')
MANIFEST = os.path.join(APP, 'clips', 'clips.manifest.json')

def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def tables_present(db):
    got = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('usage','requests')")}
    return {'usage', 'requests'} <= got

def main():
    check_only = '--check' in sys.argv
    dry = '--dry-run' in sys.argv
    ledger = json.load(open(LEDGER))
    manifest = json.load(open(MANIFEST))
    consumer = ledger.get('consumer', 'ConceptFoundations')
    src_root = os.environ.get('CLIP_SOURCE') or os.path.expanduser(
        ledger.get('source_project') or manifest.get('source_project', '~/Code/MR_AudioClips'))
    dbp = os.path.join(src_root, 'assets.db')
    if not os.path.exists(dbp):
        print(f'! shared catalog not found: {dbp}\n  set CLIP_SOURCE=/path/to/MR_AudioClips'); sys.exit(2)

    db = sqlite3.connect(dbp)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA busy_timeout=4000')
    if not tables_present(db):
        print('! shared demand tables (usage, requests) not created yet.\n'
              '  This is a producer-owned schema change — hand off '
              'docs/handoff-demand-tables.md to the MR_AudioClips session,\n'
              '  then re-run. (Nothing written.)')
        sys.exit(3)

    ts = now()
    # -- usage: DB rows for this consumer should mirror the manifest's asset_ids
    desired = {e['asset_id']: e for e in manifest['clips'] if e.get('asset_id')}
    have = {r['asset_id'] for r in db.execute('SELECT asset_id FROM usage WHERE consumer=?', (consumer,))}
    add_u = [a for a in desired if a not in have]
    del_u = [a for a in have if a not in desired]
    if not dry:
        for a, e in desired.items():
            db.execute(
                'INSERT INTO usage(asset_id,consumer,dest,phrase,used_in,updated_at) '
                'VALUES(?,?,?,?,?,?) ON CONFLICT(asset_id,consumer) DO UPDATE SET '
                'dest=excluded.dest, phrase=excluded.phrase, updated_at=excluded.updated_at',
                (a, consumer, e.get('dest'), e.get('phrase'), None, ts))
        for a in del_u:
            db.execute('DELETE FROM usage WHERE consumer=? AND asset_id=?', (consumer, a))

    # -- requests: mirror the ledger; write consumer-owned columns only, never fulfilled_by
    want = {r.get('norm', r['phrase']): r for r in ledger.get('requests', [])}
    have_req = {r['norm']: r for r in db.execute(
        'SELECT norm, fulfilled_by FROM requests WHERE consumer=?', (consumer,))}
    ship_phrases = {(e.get('phrase') or '').strip().lower() for e in manifest['clips'] if e.get('asset_id')}
    if not dry:
        for norm, r in want.items():
            db.execute(
                'INSERT INTO requests(consumer,norm,phrase,used_in,priority,constraints,currently,note,created_at,updated_at) '
                'VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(consumer,norm) DO UPDATE SET '
                'phrase=excluded.phrase, used_in=excluded.used_in, priority=excluded.priority, '
                'constraints=excluded.constraints, currently=excluded.currently, note=excluded.note, '
                'updated_at=excluded.updated_at',
                (consumer, norm, r['phrase'], '; '.join(r.get('used_in', [])) or None,
                 r.get('priority'), json.dumps(r.get('constraints')) if r.get('constraints') else None,
                 r.get('currently'), r.get('note'), ts, ts))
        for norm in have_req:
            if norm not in want:
                db.execute('DELETE FROM requests WHERE consumer=? AND norm=?', (consumer, norm))
        db.commit()

    # -- report: OPEN / READY (producer set fulfilled_by) / STALE (already shipped)
    rows, n_ready, n_stale = [], 0, 0
    fulfilled = {r['norm']: r['fulfilled_by'] for r in db.execute(
        'SELECT norm, fulfilled_by FROM requests WHERE consumer=?', (consumer,))} if not dry else {}
    for norm, r in want.items():
        if r['phrase'].strip().lower() in ship_phrases:
            state, detail = 'STALE', 'already an asset_id in clips.manifest.json — delete this request'; n_stale += 1
        elif fulfilled.get(norm):
            state, detail = 'READY', f'producer promoted → {fulfilled[norm]}; wire it into the manifest, then delete the request'; n_ready += 1
        else:
            state, detail = 'OPEN', 'awaiting promotion'
        rows.append((state, r['phrase'], r.get('priority', '?'), detail))

    verb = 'would write' if dry else 'wrote'
    print(f'demand → assets.db [{consumer}]: {verb} usage +{len(add_u)}/-{len(del_u)} '
          f'({len(desired)} live), requests {len(want)} '
          f'({n_ready} READY, {n_stale} STALE, {len(want)-n_ready-n_stale} OPEN)')
    for state, phrase, prio, detail in sorted(rows, key=lambda x: ({'READY':0,'STALE':1,'OPEN':2}[x[0]], x[1])):
        print(f'  {state:5} {phrase!r} [{prio}] — {detail}')
    if check_only and (n_ready or n_stale):
        sys.exit(1)

if __name__ == '__main__':
    main()
