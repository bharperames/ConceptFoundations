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

> **Status: agreed & implemented (schema v1, 2026-07-22).** The uid-stability
> question (§6) is resolved — the producer pins ids in a durable registry and
> retired ids carry `replaced_by`. The consumer keeps the uid join and follows
> `replaced_by`. Both sides shipped it.

---

## 1 · The interface: the index

MR_AudioClips publishes an index (today: `clips.json` at the repo root). The
consumer reads it read-only. Required shape:

```jsonc
{
  "schema_version": 1,          // REQUIRED (see §5)
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
   re-trimming — pinned in the producer's durable id registry (§6). Its
   `start`/`end`/`text`/`quality` may change under a fixed uid; the uid must not.
2. **Retirement is explicit.** A removed/superseded uid appears in the
   top-level `retired[]` array as `{uid, replaced_by, text, source}` so consumers
   can follow the chain to the live clip.
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
   - uid missing from `phrases[].clips[]` → **check `retired[]`** and follow the
     `replaced_by` chain to a live clip; repoint the manifest to the new uid
     (keeping `replaced_from` as an audit trail) and report `FOLLOWED replaced_by`.
   - only if the chain dead-ends → report **`MISSING SOURCE`**.
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

## 5 · Versioning — **done**

The index carries `schema_version` (int) and `generated_at` (ISO-8601). The
consumer reads `schema_version`: missing → treated as `0` with a warning; a value
**greater than it supports** aborts the sync rather than guessing. Currently
`schema_version: 1`.

---

## 6 · uid stability — **resolved**

Everything hinged on `uid` surviving refinement, and it now does:

- **uid is content-derived but cut-independent** — hashed from the source, a
  bucketed first-word onset, and the normalized transcript; **`start`/`end` are
  deliberately excluded**, so boundary/trim refinement never reissues an id.
- **Ids are pinned in a durable registry** on the producer side
  (`clip_ids.json`): minted once, matched back on rebuild by fingerprint then by
  source + span-overlap + text-similarity ("survived but was re-cut"). Measured
  ~96% of ids kept across a re-segmentation; the rest are genuine merges/splits.
- **Merges/splits are followable, not silent** — retired ids land in `retired[]`
  with `replaced_by`, so the consumer chases the chain (§4) to the live clip.

The consumer keeps the plain uid join; the semantic-key fallback is **not needed**
and is dropped.

### Fragile dependency to respect

The producer's `clip_ids.json` is the memory that makes ids durable — if it is
lost and a build runs, **every id is reissued** and `replaced_by` cannot rescue us
(the new ids have no lineage). It is committed, never regenerated, and the
producer's build warns loudly if it is missing while a prior build exists. On our
side, a **mass `MISSING SOURCE` across many clips at once** is the signature of
that failure — treat it as "the registry was lost," not "remap each clip."

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
