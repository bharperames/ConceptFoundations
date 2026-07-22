# Audio-clip contract: MR_AudioClips → ConceptFoundations

A contract between two repos that splits the audio work cleanly.

- **MR_AudioClips (producer)** — extracts clips from source recordings, tags and
  transcribes them, scores quality, and publishes a machine-readable **index**.
  It owns *what a clip is* (its trim boundaries, text, quality).
- **ConceptFoundations (consumer)** — selects clips it needs by stable id, pulls
  them, loudness-normalizes them, and ships them with the app. It owns *how a
  clip is used and delivered*.

The join between the two is the **index** plus a **stable clip id**. Nothing else
crosses the boundary — no filename coupling, no Google Drive, no shared code.

---

## 1 · The interface: the index

MR_AudioClips publishes an index (today: `clips.json` at the repo root). The
consumer reads it read-only. Required shape:

```jsonc
{
  "schema_version": 1,          // REQUIRED (see §5) — currently missing
  "generated_at": "ISO-8601",   // REQUIRED — when the index was produced
  "sources": [ /* source recordings */ ],
  "phrases": [
    {
      "text": "…", "norm": "…",
      "clips": [ { /* clip record, below */ } ]
    }
  ]
}
```

### Clip record — required fields (the contract surface)

| Field | Meaning | Consumer use |
|---|---|---|
| `uid` | **Stable** clip id (`clip_<hex>`) | the join key; referenced in our manifest |
| `file` | path to the extracted mp3, relative to the producer root | what we pull (file-transfer mode) |
| `source` | path to the source recording, relative to producer root | re-extraction (extract mode) + provenance |
| `start`, `end` | trim boundaries in seconds within `source` | **the "clip that clips it"** — re-extraction + change detection |
| `duration` | seconds | sanity/UI |
| `text` | transcription | phrase mapping + captions |

### Clip record — advisory fields (consumed if present)

`source_uid`, `quality`, `asr_confidence`, `is_fragment`, `is_filler`,
`has_music`, `music_score`. The consumer may use these to pick among alternates
but does not require them.

---

## 2 · Producer guarantees (MR_AudioClips must hold)

1. **Stable `uid`.** A uid identifies the *same clip* across re-tagging and
   re-trimming. Its `start`/`end`/`text`/`quality` may change under a fixed uid;
   the uid itself must not. *(This is the one guarantee to confirm — current uids
   look content-derived, which would change on re-trim. If uid cannot be made
   persistent, see §6 for the fallback join key.)*
2. **Retirement is explicit.** If a uid is removed or superseded, its record (or
   a tombstone) carries `replaced_by: "<new-uid>"` so consumers can follow it.
3. **Local, self-contained sources.** Every referenced `source`/`file` exists on
   disk under the producer root. **No dependency on Google Drive** or any remote
   origin — the local directory is the whole truth.
4. **Index is machine-readable and complete.** Every clip in `file` appears in
   the index with the required fields.

## 3 · Consumer guarantees (ConceptFoundations holds)

1. **References by `uid` only** — in `clips/clips.manifest.json`
   (`{dest, phrase, uid}`). Never by filename or Drive URL.
2. **Captures provenance.** On sync it records each clip's
   `{source, start, end, duration, text, quality, has_music}` under `clip`, plus
   `src_sha256` (producer file) and `dest_sha256` (our normalized file).
3. **Normalizes on copy** to a consistent loudness (~−14 LUFS + peak limiter) so
   clips match each other and the TTS voice.
4. **Detects change** and re-pulls when either the producer file's bytes *or* the
   clip metadata (trim/text) changes for a uid.

---

## 4 · Sync protocol

`make sync-clips` (`scripts/sync_clips.py`):

1. Load our manifest and the producer index (`CLIP_SOURCE` env, default
   `~/Code/MR_AudioClips`).
2. For each manifest entry, resolve `uid → record` in the index.
   - uid missing → report **`MISSING SOURCE`** (needs remap / follow `replaced_by`).
3. Fresh if `dest` exists **and** `src_sha256` matches **and** stored `clip`
   metadata matches. Otherwise pull + normalize + rewrite the entry.
4. `--check` reports staleness with a non-zero exit (CI); `--raw` skips
   normalization; missing ffmpeg degrades to a plain copy.

**Transfer modes**

- **File copy (default today):** copy the producer's pre-cut `file`, then
  normalize. Preserves any producer-side processing (fades, etc.).
- **Extract from source (optional, enabled by the metadata we now capture):**
  cut `source[start:end]` locally with ffmpeg, then normalize. Fully decouples us
  from the producer's clip *files* — we need only its *index* + the local sources.
  Use this if the producer stops shipping cut files, or for independence.

---

## 5 · Versioning

The index currently has **no `schema_version`**. The contract asks the producer
to add `schema_version` (integer) and `generated_at`. The consumer treats a
missing version as `0` and logs a warning; a major bump it doesn't recognize
should stop the sync rather than guess.

---

## 6 · The one open decision — uid stability

Everything hinges on `uid` surviving refinement. Two ways to satisfy it:

- **A — producer keeps uid stable (preferred).** When a clip is first extracted
  it gets a durable id; later re-trims/re-tags keep that id. Content changes are
  observed by the consumer via the file hash + captured trim metadata.
- **B — join on a semantic key (fallback).** If uids must stay content-derived,
  the durable handle becomes `(source_uid + norm(text))` or a producer-maintained
  alias table, and the manifest references that instead of a raw uid.

**Recommendation: A.** It keeps the join trivial (one id) and lets trim/text/
quality evolve freely underneath. This is the item to confirm with MR_AudioClips.

---

## 7 · Worked example — the "uh-oh" clip

Producer index record → consumer manifest entry:

```jsonc
// producer (clips.json)                     // consumer (clips.manifest.json)
{ "uid": "clip_0dcdb7046530",                 { "dest": "uh_oh_song.mp3",
  "file": "clips/clip_0dcdb..._song.mp3",       "phrase": "this is the uh oh song",
  "source": "raw_audio/dinoplay.mp3",           "uid": "clip_0dcdb7046530",
  "start": 113.814, "end": 116.044,             "clip": { "source": "raw_audio/dinoplay.mp3",
  "duration": 2.23,                                       "start": 113.814, "end": 116.044,
  "text": "This is the uh-oh song." }                     "duration": 2.23, "text": "This is the uh-oh song." },
                                                "src_sha256": "…", "dest_sha256": "…",
                                                "normalized": "-14.0 LUFS + limiter" }
```

The consumer holds enough to re-extract this clip from the local
`raw_audio/dinoplay.mp3` at 113.814–116.044s without ever touching the producer's
cut file or any remote origin.
