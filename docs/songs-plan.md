# Songs screen — plan & distribution analysis

A plan to add a **Songs** screen that plays full-length songs, and an analysis of
what that does to the GitHub Pages distribution. Nothing here is built yet.

**Source of truth:** the local `~/Code/MR_AudioClips/raw_audio/` directory only.
The songs also carry Google Drive URLs in `clips.json`, but **we do not reference
Drive** — not at build time and not at runtime. The local files are the origin;
Drive is ignored entirely.

---

## 1 · Inventory (measured from MR_AudioClips)

| Metric | Value |
|---|---|
| Songs (`is_song`) | **54** |
| Total audio | **74.7 MB** |
| Total duration | **81 min** |
| Avg per song | 1.38 MB · 1.5 min |
| Median / max | 1.14 MB / 3.77 MB (*bubblegum*, 3 min) |
| Format | mp3 (100%) |

For scale: the app today is ~0.8 MB of served files with a 1.6 MB git history.

---

## 2 · Distribution impact

GitHub Pages' documented **soft** limits: ~1 GB published site, ~100 GB/month
bandwidth; git's **hard** limit is 100 MB/file. All songs are < 4 MB, so the file
limit is a non-issue. The two real axes are **git-history weight** and
**bandwidth**.

### Option A — bundle songs in the repo (served by Pages, like today's assets)

| Dimension | Impact |
|---|---|
| Site size | ~76 MB — far under the 1 GB soft limit ✅ |
| Bandwidth | ~1.4 MB/play → **~72,000 plays/month** before the 100 GB soft cap. Fine for personal/family scale; against GitHub's guidance at real scale ⚠️ |
| **Git history** | **The blocker.** The song DB is actively refined. Binaries in git are permanent — every re-encode appends another full copy to history. 75 MB baseline that grows with every refresh; clones/CI get heavier forever ❌ |
| Simplicity | Highest — identical to current delivery, self-contained, PWA-cacheable ✅ |

Mitigation if you still choose A: **git LFS** keeps the working history light (LFS
stores large blobs out of band, deduped by content).

### Option B — host songs off-git, reference by a manifest *(recommended)*

- **GitHub Releases assets** — attach the 75 MB of mp3s to a release; served from
  GitHub's CDN, **not in the Pages repo or git history** → zero bloat, generous
  limits, still all-GitHub and free. The app fetches stable asset URLs.
- **Cloudflare R2** — 10 GB free, **zero egress fees**; best if this ever scales,
  at the cost of one external dependency + setup.

Either keeps the Pages repo lean while the song DB churns.

### Option C — hybrid

Bundle 3–4 favorites in-repo for instant/offline play; stream the rest from B.

### Recommendation

Because the song DB changes over time, **do not put 75 MB of moving binaries into
git history.** Host the files via **GitHub Releases** (or R2) and reference them
from a **checksummed songs manifest** — the same stable-ID + sha256 pattern the
clip sync already uses. If you insist on the simplest possible path and only ever
personal scale, Option A + git LFS is acceptable.

### Delivery notes (any host)

- Play songs with an **HTML `<audio>` element**, *not* the Web Audio decode path
  the short clips use — `<audio>` streams progressively, supports seeking, and
  doesn't load whole files into memory.
- Optional: **re-encode to ~64–96 kbps mono** to roughly halve storage/bandwidth;
  kids' songs don't need 128 k stereo. (Do this in a build step from the local
  `raw_audio` originals.)
- mp3 supports HTTP range on Fastly/Releases, so seek + progressive playback work.

---

## 3 · The Songs screen (product)

1. **Home entry** — a "Songs" section (mirroring the Mini games section), or a
   top-level card.
2. **Library screen** — a grid of song cards: title + a generated colorful cover
   (procedural art per song), tap to play.
3. **Now-playing screen** — big cover/animation (bouncing notes or a simple
   visualizer), title, and large kid-friendly controls: play/pause, scrub bar,
   prev/next, back. Optional auto-advance to the next song.
4. **Data** — `songs.manifest.json` (title, id, file/URL, duration, sha256) plus a
   `sync_songs.py` (extending the existing clip sync) that copies/points to the
   local `raw_audio` originals by ID + checksum, so refined songs update cleanly.

---

## 4 · Phasing

- **Phase 0 (decision):** pick the hosting route (A + LFS, B, or C). This forks
  everything downstream. *Recommended: B — GitHub Releases + checksummed manifest.*
- **Phase 1:** songs manifest + sync script (local `raw_audio` → chosen host).
- **Phase 2:** library screen + `<audio>` player UI + wiring.
- **Phase 3:** procedural cover art + now-playing animation.
- **Phase 4:** player tests, deploy.

---

## 5 · Before distributing — licensing

81 minutes of full songs is a much larger copyright exposure than the short
spoken clips; full nursery/kids songs are very likely someone's IP. Bundling or
streaming them from a public URL distributes them. This is unresolved and worth
settling before the public link goes wide, independent of the hosting choice.

---

## Open decisions for the human

1. **Hosting route** — A (+ git LFS), B (Releases/R2), or C (hybrid)?
2. **Placement** — Songs as its own top-level area, or grouped with Mini games
   under a "Media/Extras" umbrella?
3. **Re-encode** — ship the originals, or downsample to ~half size first?
