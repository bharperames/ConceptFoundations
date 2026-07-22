# Audio-clip contract: MR_AudioClips → ConceptFoundations

A contract between two repos that splits the audio work cleanly.

- **MR_AudioClips (producer)** — curates a **gold catalog** of finished, named
  assets: it decides which clips are good enough to ship, gives each a durable id,
  and publishes them in a queryable catalog. It owns *what an asset is*.
- **ConceptFoundations (consumer)** — selects the assets it needs by durable id,
  pulls them, loudness-normalizes them, and embeds them with the app. It owns
  *how an asset is used and delivered*.

The join is the producer's **gold catalog** plus a durable **`asset_id`**. Nothing
else crosses the boundary — no filename coupling, no Google Drive, no shared code,
and **no database inside the shipped app**.

> **Status: gold layer, schema v1 (2026-07-22).** Migrated from the earlier
> silver `clips.json`/`uid` interface to the producer's curated **gold** layer
> (`assets.db` / `asset_id`). `asset_id` is minted once by a human and never
> recomputed, which retires the old uid-stability problem (§6) entirely.

---

## 1 · The interface: the gold catalog

The producer publishes three layers; **exactly one is the contract surface**:

| Layer | What it is | Consumer stance |
|---|---|---|
| bronze | raw candidate segments | ignore |
| silver | auto-tagged working set (`clips.json`, `clips/`) | **never read** |
| **gold** | human-curated finished assets (`assets.db` + `assets/`) | **the only thing we consume** |

**Gold is a single SQLite catalog**, `assets.db`, exposing a `catalog` view (one
row per asset), an `assets_fts` full-text index, and a `meta` table
(`schema_version`, `generated_at`, `asset_count`). Assets live in `assets/`. The
`meta` table is written in the *same transaction* as the rows, so the version and
freshness can never drift from the data — there is no separate JSON mirror to fall
out of sync. *(An earlier `assets.json` mirror was removed 2026-07-22 for exactly
that reason; the consumer reads `meta` and never a second copy.)*

### `catalog` columns — the contract surface

| Field | Meaning | Consumer use |
|---|---|---|
| `asset_id` | **Durable** id (`asset_<hex>`), minted once by a human | the join key; referenced in our manifest |
| `file` | path to the mp3, relative to the producer root | what we pull |
| `name` | human label | disambiguation, captions |
| `text` | transcription | phrase mapping + captions |
| `norm` | normalized transcription | retrieval / matching key |
| `source_file`, `start`, `end` | provenance (re-extraction) | provenance |
| `duration` | seconds | advisory filter (length) |
| `has_music` | backing music present | advisory filter (clean vs musical) |
| `voice_id` | speaker, when known | preference via `ORDER BY`, not `WHERE` (sparse) |
| `updated_at` | ISO-8601 last change | **change detection** |

`has_music` and `duration` are the **only** advisory filters that survived the
silver→gold move (quality/asr_confidence/is_fragment/is_filler are gone). Because
we hand-pick each asset in the manifest, we *record* these but don't filter on them.

---

## 2 · Producer guarantees (MR_AudioClips holds)

1. **Durable `asset_id`.** Minted once by a human act and never recomputed. An
   asset's `text`/`start`/`end`/`name` may be refined under a fixed id; the id
   does not change.
2. **No tombstones — removal is disappearance.** A de-curated asset simply leaves
   the catalog. There is no `retired[]`/`replaced_by` chain to follow (gold is a
   curated set, not a derivation graph). A vanished `asset_id` means "removed."
3. **Local, self-contained.** Every `file`/`source_file` exists on disk under the
   producer root. No dependency on Google Drive or any remote origin.
4. **Catalog is complete and queryable.** Every shippable asset appears in
   `catalog` with the fields above; the `meta` table carries the version + freshness.
5. **Promotion is cheap.** When we name a phrase that isn't in gold yet (§6), the
   producer promotes the existing silver clip into gold, minting its `asset_id`.

## 3 · Consumer guarantees (ConceptFoundations holds)

1. **Consume gold only.** The acquire tool reads `assets.db` (catalog / FTS / meta);
   it **never** reads silver (`clips.json`, `clips/`) and never globs filenames.
2. **The database dependency is build-time only.** SQL lives solely in
   `scripts/sync_clips.py`. The shipped app (`index.html`) plays the embedded
   mp3s in `clips/` by filename and never touches a database.
3. **References by `asset_id`** in `clips/clips.manifest.json`
   (`{dest, phrase, asset_id}`). Never by producer filename or Drive URL.
4. **Captures provenance.** On acquire it records each asset's
   `{name, text, source_file, start, end, duration, has_music, voice_id,
   updated_at}` under `asset`, plus `src_sha256` (producer file) and `dest_sha256`
   (our normalized file).
5. **Normalizes on copy** to a consistent loudness (~−14 LUFS + peak limiter → the
   shipped mp3 lands ~−13) so clips match each other and the TTS voice.
6. **Detects change** via the asset's `updated_at` (and the source-byte hash) and
   re-pulls when either moves.
7. **Names gaps, doesn't work around them.** A needed phrase absent from gold is
   flagged `pending_gold` in the manifest (its committed file is kept so the app
   keeps working) and listed for promotion — never silently re-sourced from silver.

---

## 4 · Acquire protocol

`make sync-clips` (`scripts/sync_clips.py`):

1. Load our manifest; open `assets.db` **read-only** (`CLIP_SOURCE` env, default
   `~/Code/MR_AudioClips`). Read `schema_version`/`generated_at` from the `meta`
   table (an older producer without it degrades gracefully); a `schema_version`
   greater than supported aborts rather than guessing.
2. For each manifest entry:
   - `asset_id` set → `SELECT … FROM catalog WHERE asset_id=?`. Not found →
     **`MISSING`** (removed from gold; re-pick in the manifest).
   - `pending_gold` set (no `asset_id`) → leave the committed file, report
     **`PENDING GOLD`**.
3. Fresh if `dest` exists **and** `src_sha256` matches **and** the stored `asset`
   metadata (incl. `updated_at`) matches. Otherwise pull + normalize + rewrite.
4. `--check` reports staleness with a non-zero exit (CI); `--raw` skips
   normalization; missing ffmpeg degrades to a plain copy.

---

## 5 · Versioning

The `meta` table carries `schema_version` (int), `generated_at` (ISO-8601), and
`asset_count`. The consumer aborts on a `schema_version` greater than it supports
rather than guessing. Currently `schema_version: 1`.

---

## 6 · Coverage & promotion (replaces the old uid-stability section)

`asset_id` durability closes the entire uid-stability thread — there is nothing to
stabilize because ids aren't derived, they're minted. What replaces it as the live
concern is **coverage**: gold is a *curated subset*, so a phrase we need may not
be in it yet.

The rule (producer's guidance): **when a phrase is missing, name it for promotion
rather than working around it.** Promotion takes seconds and the clip very likely
already exists in silver, unpromoted.

**No current gaps.** All four earlier gaps were promoted (2026-07-22) and are now
gold-backed: `yay` → `asset_26bd51ec05cc`, `we did it` → `asset_98cf57f963af`,
`peekaboo` → `asset_9ed2a86acb62`, `out` → `asset_d703e812fbff`. The original
promotion request is preserved in `docs/message-to-mr-audioclips.md`.

**Resolution is by `asset_id`, not by `norm`** — which sidesteps a normalization
gotcha the producer flagged: `norm` follows the transcript, so "Peek-a-boo!"
normalizes to `peek a boo`, not `peekaboo`. Anything that *discovers* an asset by
phrase must FTS-match or use the transcript spelling; but once an `asset_id` is
pinned in the manifest we join on it directly and the colloquial-vs-transcript
spelling never enters into it.

### Failure signature to respect

A **mass `MISSING` across many asset_ids at once** means the gold catalog was
rebuilt in a way that dropped ids — treat it as "the catalog regressed," not
"re-pick each asset."

---

## 7 · Worked example — the "Great Job" asset

Producer catalog row → consumer manifest entry:

```jsonc
// producer (assets.db catalog)                 // consumer (clips.manifest.json)
{ "asset_id": "asset_035ccb0bf490",             { "dest": "great_job.mp3",
  "name": "Great Job",                            "phrase": "great job",
  "text": "Great job!",                           "asset_id": "asset_035ccb0bf490",
  "file": "assets/asset_035…__great_job.mp3",     "asset": { "name": "Great Job",
  "source_file": "raw_audio/we_re_waving.mp3",             "text": "Great job!",
  "start": 45.824, "end": 46.977,                          "source_file": "raw_audio/we_re_waving.mp3",
  "duration": 1.153, "has_music": 0,                       "start": 45.824, "end": 46.977,
  "updated_at": "2026-07-22T15:23:41Z" }                   "duration": 1.153, "has_music": 0,
                                                           "updated_at": "2026-07-22T15:23:41Z" },
                                                  "src_sha256": "…", "dest_sha256": "…",
                                                  "normalized": "-14.0 LUFS + limiter" }
```

We join on `asset_id`; if the producer refines the trim or renames the file, the
id is unchanged and the next acquire re-pulls automatically off `updated_at`.

---

## 8 · The back-channel — registering usage & requests (demand)

The catalog is the producer→consumer direction (supply). This is the
consumer→producer direction (demand). It's built on the **same discipline** the
`assets.json` removal established: *never keep two copies of one fact that can
drift.* So there is **no generated projection** — the producer reads our source
files directly, exactly as we read `assets.db` directly. Three source files, each
owned by one side, none duplicating another:

| File | Owner | Direction | Says |
|---|---|---|---|
| `assets.db` (`meta`+`catalog`) | producer | supply | what exists |
| `clips/clips.manifest.json` | consumer | demand · in-use | which `asset_id`s we depend on ("don't de-curate these") |
| `audio-requests.json` | consumer | demand · wanted | phrases we need that gold lacks |

**In-use is not re-published.** The manifest already lists every `asset_id` we
ship; that *is* the dependency signal. The producer reads it before removing an
asset (gold has no tombstones, so this is how they know who's holding a reference).

**The requests ledger has no status field.** Presence == open. Fulfillment is
*migration*, not a flag: when a phrase is promoted, its `asset_id` moves into the
manifest and the request is **deleted** from the ledger. "Done" == "gone", so a
request can never be marked-done-yet-still-listed — the exact drift the
`assets.json` mirror could suffer, designed out by construction.

**Reconcile, don't mirror.** `scripts/export_requests.py` (`make audio-requests`)
is to demand what `sync_clips.py` is to supply: it *writes nothing*, reads the
ledger + the manifest + live gold, and reports each request as `OPEN` (gold lacks
it), `READY` (gold has a match now → wire it into the manifest, delete the
request), or `STALE` (already in the manifest → delete the request). `--check`
exits non-zero on any `READY`/`STALE`, so CI catches us drifting behind gold.

**The TTS backlog is a report, not a contract file.** "Every line the app speaks,
flagged curated-vs-TTS" is a *projection* of `index.html`, so it is generated on
demand — never committed as a second source that could drift from the app.

Lifecycle of one request (`out`, already completed): named in the ledger → producer
promotes silver → mints `asset_id` → consumer wires it into the manifest and
**removes it from the ledger** → `export_requests.py` would flag it `STALE` if left
behind. The four July-22 promotions (`yay`, `we did it`, `peekaboo`, `out`) ran
this loop; the ledger now holds only the still-open `up` / `down` / `in`.
