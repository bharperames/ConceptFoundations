#!/usr/bin/env python3
"""Reconcile the audio demand ledger against the producer's live gold catalog.

The mirror of sync_clips.py. sync_clips reconciles our *files* against gold
supply; this reconciles our *demand* (audio-requests.json) against gold supply.
It writes nothing — no generated projection to drift (the same discipline that
retired the producer's assets.json mirror). It just reports, per open request:

  OPEN   gold still lacks the phrase — a genuine ask for the producer.
  READY  gold now has a match (exact norm, or FTS candidate) — go wire it into
         clips/clips.manifest.json, then delete the request from the ledger.
  STALE  the phrase is already an asset_id in our manifest — the request was
         fulfilled but not deleted; remove it.

The contract is: read the producer's assets.db directly, read our own two source
files directly, duplicate nothing.

  python3 scripts/export_requests.py           # human report
  python3 scripts/export_requests.py --check   # non-zero exit on any READY/STALE
  CLIP_SOURCE=/path/to/MR_AudioClips python3 scripts/export_requests.py
"""
import json, os, sys, sqlite3

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(APP, 'audio-requests.json')
MANIFEST = os.path.join(APP, 'clips', 'clips.manifest.json')

def open_catalog(src_root):
    dbp = os.path.join(src_root, 'assets.db')
    if not os.path.exists(dbp):
        print(f'! producer gold catalog not found: {dbp}\n'
              f'  set CLIP_SOURCE=/path/to/MR_AudioClips'); sys.exit(2)
    db = sqlite3.connect(f'file:{dbp}?mode=ro', uri=True); db.row_factory = sqlite3.Row
    return db

def fts_candidates(db, phrase, limit=3):
    """Best-effort discovery: OR the phrase words through the FTS index."""
    q = ' OR '.join(w for w in phrase.split() if w)
    if not q:
        return []
    try:
        rows = db.execute(
            'SELECT c.asset_id, c.name, c.norm FROM assets_fts f '
            'JOIN catalog c ON c.asset_id = f.asset_id '
            'WHERE assets_fts MATCH ? LIMIT ?', (q, limit)).fetchall()
    except sqlite3.OperationalError:
        return []
    return [(r['asset_id'], r['name'], r['norm']) for r in rows]

def main():
    check_only = '--check' in sys.argv
    ledger = json.load(open(LEDGER))
    manifest = json.load(open(MANIFEST))
    src_root = os.environ.get('CLIP_SOURCE') or os.path.expanduser(
        ledger.get('source_project') or manifest.get('source_project', '~/Code/MR_AudioClips'))
    db = open_catalog(src_root)

    # phrases we already ship (authoritative in-use list — no duplication)
    have_phrases = {(e.get('phrase') or '').strip().lower() for e in manifest['clips'] if e.get('asset_id')}

    rows, n_ready, n_stale = [], 0, 0
    for r in ledger.get('requests', []):
        phrase, norm = r['phrase'], r.get('norm', r['phrase'])
        if phrase.strip().lower() in have_phrases:
            state, detail = 'STALE', 'already an asset_id in clips.manifest.json — delete this request'
            n_stale += 1
        else:
            exact = db.execute('SELECT asset_id, name FROM catalog WHERE norm=?', (norm,)).fetchall()
            if exact:
                state = 'READY'; detail = 'exact gold match: ' + ', '.join(f'{x["asset_id"]} ({x["name"]})' for x in exact)
                n_ready += 1
            else:
                cands = fts_candidates(db, phrase)
                if cands:
                    state = 'READY'; detail = 'FTS candidate(s): ' + ', '.join(f'{a} ({n} · norm={q!r})' for a, n, q in cands)
                    n_ready += 1
                else:
                    state = 'OPEN'; detail = 'not in gold — request stands'
        rows.append((state, phrase, r.get('priority', '?'), detail))

    order = {'READY': 0, 'STALE': 1, 'OPEN': 2}
    rows.sort(key=lambda x: (order[x[0]], x[1]))
    print(f'demand ledger: {len(rows)} open request(s) vs gold — '
          f'{n_ready} READY, {n_stale} STALE, {len(rows)-n_ready-n_stale} OPEN')
    for state, phrase, prio, detail in rows:
        print(f'  {state:5} {phrase!r} [{prio}] — {detail}')
    if not rows:
        print('  (ledger empty — gold covers everything we ask for)')
    if check_only and (n_ready or n_stale):
        sys.exit(1)

if __name__ == '__main__':
    main()
