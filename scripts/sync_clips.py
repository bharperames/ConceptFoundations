#!/usr/bin/env python3
"""Sync mapped audio clips from the companion clip database, by stable UID +
sha256, and loudness-normalize them on copy so recorded clips are consistent
with each other and sit at the same level as the synthesized TTS voice.

Source of truth: clips/clips.manifest.json (dest ← source UID + phrase).
The companion project's clips.json maps UID → current file, so a clip that the
other app refines (new content, or even a new filename) is still resolved by
UID and re-normalized when its source checksum changes.

Normalization: loudness gain to TARGET_LUFS + a peak limiter (ffmpeg), which
converges every clip to ~TARGET with true-peak < 0 dB (no clipping). The
manifest stores src_sha256 (to detect source changes) and dest_sha256.

  python3 scripts/sync_clips.py            # sync + normalize + update checksums
  python3 scripts/sync_clips.py --check    # report only, non-zero exit if stale
  python3 scripts/sync_clips.py --raw      # copy without normalizing
  CLIP_SOURCE=/path/to/MR_AudioClips python3 scripts/sync_clips.py
"""
import json, hashlib, os, sys, shutil, subprocess, re, tempfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(APP, 'clips', 'clips.manifest.json')
TARGET_LUFS = -14.0   # measured output lands ~-13 after the limiter; matches TTS

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

def main():
    check_only = '--check' in sys.argv
    raw = '--raw' in sys.argv
    do_norm = not raw and have_ffmpeg()
    if not raw and not have_ffmpeg():
        print('! ffmpeg not found — copying without normalization (install ffmpeg to normalize)')

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
        # fresh when the dest exists and the SOURCE hasn't changed since last sync
        # (dest content differs from source because it's normalized, so we track
        # the source hash, not a dest==source comparison)
        fresh = os.path.exists(dest) and e.get('src_sha256') == src_hash
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
        e.pop('sha256', None)          # migrate old key
        e['src_sha256'] = src_hash
        e['dest_sha256'] = sha(dest)
        e['source_file'] = os.path.relpath(src, src_root)
        e['normalized'] = f'{TARGET_LUFS} LUFS + limiter' if do_norm else 'raw'
        updated.append(e)

    if not check_only:
        json.dump(m, open(MANIFEST, 'w'), indent=2); open(MANIFEST, 'a').write('\n')

    verb = 'stale' if check_only else 'updated'
    print(f'clips: {len(ok)} up-to-date, {len(updated)} {verb}, {len(missing)} missing source'
          + ('' if not do_norm else f'  (normalized to ~{TARGET_LUFS} LUFS)'))
    for e in updated: print(f'  {verb.upper()}: {e["dest"]}  ({e["phrase"]!r}  uid {e["uid"]})')
    for e in missing: print(f'  MISSING SOURCE: {e["dest"]}  uid {e["uid"]} — remap in manifest')
    if missing or (check_only and updated): sys.exit(1)

if __name__ == '__main__':
    main()
