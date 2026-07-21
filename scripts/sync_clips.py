#!/usr/bin/env python3
"""Sync mapped audio clips from the companion clip database, by stable UID +
sha256, so refined source clips replace stale copies and nothing drifts.

Source of truth: clips/clips.manifest.json (dest ← source UID + phrase).
The companion project's clips.json maps UID → current file, so a clip that the
other app refines (new content, or even a new filename) is still resolved by
UID and re-copied when its checksum changes.

  python3 scripts/sync_clips.py            # sync + update checksums
  python3 scripts/sync_clips.py --check    # report only, non-zero exit if stale
  CLIP_SOURCE=/path/to/MR_AudioClips python3 scripts/sync_clips.py
"""
import json, hashlib, os, sys, shutil

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(APP, 'clips', 'clips.manifest.json')

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    check_only = '--check' in sys.argv
    m = json.load(open(MANIFEST))
    src_root = os.environ.get('CLIP_SOURCE') or os.path.expanduser(m.get('source_project', '~/Code/MR_AudioClips'))
    libp = os.path.join(src_root, 'clips.json')
    if not os.path.exists(libp):
        print(f'! companion library not found: {libp}\n  set CLIP_SOURCE=/path/to/MR_AudioClips'); sys.exit(2)
    lib = json.load(open(libp))
    uid2file = {}
    for ph in lib.get('phrases', []):
        for c in ph.get('clips', []):
            uid2file[c['uid']] = os.path.join(src_root, c['file'])

    updated, missing, ok = [], [], []
    for e in m['clips']:
        dest = os.path.join(APP, 'clips', e['dest'])
        src = uid2file.get(e['uid'])
        if not src or not os.path.exists(src):
            missing.append(e); continue
        src_hash = sha(src)
        fresh = os.path.exists(dest) and e.get('sha256') == src_hash and sha(dest) == src_hash
        if fresh:
            ok.append(e); continue
        if check_only:
            e['_new_hash'] = src_hash; updated.append(e); continue
        shutil.copy2(src, dest); e['sha256'] = src_hash; e['source_file'] = os.path.relpath(src, src_root)
        updated.append(e)

    if not check_only:
        json.dump(m, open(MANIFEST, 'w'), indent=2); open(MANIFEST, 'a').write('\n')

    print(f'clips: {len(ok)} up-to-date, {len(updated)} {"stale" if check_only else "updated"}, {len(missing)} missing source')
    for e in updated: print(f'  {"STALE" if check_only else "updated"}: {e["dest"]}  ({e["phrase"]!r}  uid {e["uid"]})')
    for e in missing: print(f'  MISSING SOURCE: {e["dest"]}  uid {e["uid"]} — remap in manifest')
    if missing or (check_only and updated): sys.exit(1)

if __name__ == '__main__':
    main()
