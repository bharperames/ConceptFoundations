#!/usr/bin/env python3
"""Acquire mapped audio clips from the producer's GOLD layer and loudness-
normalize them on copy so recorded clips are consistent with each other and
sit at the same level as the synthesized TTS voice.

This is BUILD tooling, not shipped code. The SQL dependency lives only here:
the producer (MR_AudioClips) publishes a curated gold catalog (assets.db, a
SQLite `catalog` view keyed by a durable `asset_id`); this script queries it
read-only, copies the referenced mp3, normalizes it, and embeds it in clips/.
The app itself only ever plays those embedded mp3s — it never touches a DB.

Gold contract (see docs/audio-clip-contract.md):
  - Consume gold only. Never read the producer's silver (clips.json/clips/).
  - Join on asset_id — minted once by a human, never recomputed. No uid hashing,
    no retired[]/replaced_by chains: a removed asset simply disappears.
  - Query SQL (catalog view / assets_fts), never glob filenames.
  - has_music + duration are the only advisory filters that survive; clips are
    hand-picked in the manifest, so we record them but don't filter on them.
  - Change is detected via the asset's `updated_at` (+ a source-byte hash).

Source of truth: clips/clips.manifest.json (dest ← asset_id + phrase).
Entries with `pending_gold` are phrases not yet in gold; their committed file
is left untouched and reported so we can request promotion.

  python3 scripts/sync_clips.py            # acquire + normalize + update manifest
  python3 scripts/sync_clips.py --check    # report only, non-zero exit if stale
  python3 scripts/sync_clips.py --raw      # copy without normalizing
  CLIP_SOURCE=/path/to/MR_AudioClips python3 scripts/sync_clips.py
"""
import json, hashlib, os, sys, shutil, subprocess, re, tempfile, sqlite3

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(APP, 'clips', 'clips.manifest.json')
TARGET_LUFS = -14.0   # measured output lands ~-13 after the limiter; matches TTS
SUPPORTED_SCHEMA = 1

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()

def have_ffmpeg():
    return shutil.which('ffmpeg') is not None

def measure_lufs(f):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', f,
        '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
        capture_output=True, text=True).stderr
    m = re.findall(r'I:\s*(-?\d+\.?\d*)\s*LUFS', out)
    return float(m[-1]) if m else None

def normalize(src, dest):
    """Loudness gain to TARGET_LUFS + peak limiter → dest (mp3)."""
    lufs = measure_lufs(src)
    if lufs is None:
        shutil.copy2(src, dest); return
    gain = TARGET_LUFS - lufs
    af = f"volume={gain:.2f}dB,alimiter=level_in=1:level_out=1:limit=0.85:attack=4:release=60"
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-af', af, '-ar', '44100', '-b:a', '128k', dest], check=True)

# --- gold catalog access (the only SQL in the project) ---------------------
CATALOG_COLS = ('asset_id', 'name', 'text', 'norm', 'file', 'voice_id',
                'has_music', 'duration', 'source_file', 'start', 'end',
                'notes', 'updated_at')

def open_catalog(src_root):
    dbp = os.path.join(src_root, 'assets.db')
    if not os.path.exists(dbp):
        print(f'! producer gold catalog not found: {dbp}\n'
              f'  set CLIP_SOURCE=/path/to/MR_AudioClips'); sys.exit(2)
    db = sqlite3.connect(f'file:{dbp}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db

def catalog_header(db):
    """schema_version + generated_at from the catalog's `meta` table — the single
    source of truth, written in the same transaction as the rows so it can't drift
    from them (unlike the old assets.json mirror, now removed). An older producer
    without a `meta` table degrades to (None, None)."""
    try:
        meta = dict(db.execute('SELECT key, value FROM meta').fetchall())
    except sqlite3.OperationalError:      # producer predates the meta table
        return None, None
    ver = meta.get('schema_version')
    return (int(ver) if ver is not None else None), meta.get('generated_at')

def fetch_by_asset_id(db, asset_id):
    cols = ','.join(CATALOG_COLS)
    return db.execute(f'SELECT {cols} FROM catalog WHERE asset_id=?', (asset_id,)).fetchone()

def asset_meta(row):
    """Provenance we keep per gold asset (advisory: has_music + duration)."""
    return {k: row[k] for k in ('name', 'text', 'source_file', 'start', 'end',
                                'duration', 'has_music', 'voice_id', 'updated_at')}

def main():
    check_only = '--check' in sys.argv
    raw = '--raw' in sys.argv
    do_norm = not raw and have_ffmpeg()
    if not raw and not have_ffmpeg():
        print('! ffmpeg not found — copying without normalization (install ffmpeg to normalize)')

    m = json.load(open(MANIFEST))
    src_root = os.environ.get('CLIP_SOURCE') or os.path.expanduser(m.get('source_project', '~/Code/MR_AudioClips'))
    db = open_catalog(src_root)
    ver, generated_at = catalog_header(db)
    if ver is not None and ver > SUPPORTED_SCHEMA:
        print(f'! gold schema_version {ver} > supported {SUPPORTED_SCHEMA}; update the consumer. Aborting.'); sys.exit(2)

    updated, missing, ok, pending = [], [], [], []
    for e in m['clips']:
        dest = os.path.join(APP, 'clips', e['dest'])
        aid = e.get('asset_id')
        if not aid:
            # phrase not yet promoted to gold — keep the committed file, report it
            pending.append(e); continue
        row = fetch_by_asset_id(db, aid)
        if row is None:
            # gold has no tombstones: a vanished asset_id means it was removed.
            missing.append(e); continue
        src = os.path.join(src_root, row['file'])
        if not os.path.exists(src):
            missing.append(e); continue
        src_hash = sha(src)
        meta = asset_meta(row)
        # fresh when dest exists, the source bytes are unchanged, AND the gold
        # asset's updated_at/metadata is unchanged. (dest differs from source
        # because it's normalized, so compare the source hash + metadata.)
        fresh = os.path.exists(dest) and e.get('src_sha256') == src_hash and e.get('asset') == meta
        if fresh:
            ok.append(e); continue
        if check_only:
            updated.append(e); continue
        if do_norm:
            with tempfile.TemporaryDirectory() as td:
                tmp = os.path.join(td, 'n.mp3')
                normalize(src, tmp); shutil.move(tmp, dest)
        else:
            shutil.copy2(src, dest)
        for k in ('uid', 'sha256', 'source_file', 'clip', 'replaced_from'):
            e.pop(k, None)                          # migrate away old silver keys
        e['asset'] = meta                           # gold provenance
        e['src_sha256'] = src_hash
        e['dest_sha256'] = sha(dest)
        e['normalized'] = f'{TARGET_LUFS} LUFS + limiter' if do_norm else 'raw'
        updated.append(e)

    if not check_only:
        json.dump(m, open(MANIFEST, 'w'), indent=2); open(MANIFEST, 'a').write('\n')

    verb = 'stale' if check_only else 'updated'
    print(f'gold catalog (schema v{ver}, {generated_at or "?"}) — '
          f'clips: {len(ok)} up-to-date, {len(updated)} {verb}, '
          f'{len(pending)} pending-gold, {len(missing)} missing'
          + ('' if not do_norm else f'  (normalized to ~{TARGET_LUFS} LUFS)'))
    for e in updated: print(f'  {verb.upper()}: {e["dest"]}  ({e["phrase"]!r}  {e["asset_id"]})')
    for e in pending: print(f'  PENDING GOLD: {e["dest"]}  ({e["phrase"]!r}) — kept committed file; promotion requested')
    for e in missing: print(f'  MISSING: {e["dest"]}  {e["asset_id"]} — asset_id not in gold catalog (removed?); re-pick in manifest')
    if missing or (check_only and updated): sys.exit(1)

if __name__ == '__main__':
    main()
