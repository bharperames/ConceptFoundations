# Handoff: add demand tables to `assets.db` (schema mutation request)

*(Paste to the MR_AudioClips session. This asks the producer — the schema owner —
to add two consumer-written tables to `assets.db` so that **usage** and
**requests** live in the shared catalog alongside supply, and the curator can
query and interoperate with them directly.)*

---

## Why

Today demand lives in files in the consumer repo (`clips.manifest.json` for
in-use, `audio-requests.json` for wants). You asked to make `assets.db` the
**shared resource for both producer and consumer** so the curator can
`SELECT`/`JOIN` demand against supply in one place. That means two new tables the
**consumer writes** and the **curator reads** (and replies to). You own the
schema because you own the file and the rebuild pipeline.

## The two tables

```sql
-- Who ships which asset. One row per (consumer, asset_id). The "don't
-- de-curate this" signal: gold has no tombstones, so this is how you know a
-- reference is live before removing an asset.
CREATE TABLE IF NOT EXISTS usage (
    asset_id   TEXT NOT NULL REFERENCES assets(asset_id),
    consumer   TEXT NOT NULL,          -- e.g. 'ConceptFoundations'
    dest       TEXT,                   -- consumer's shipped filename (great_job.mp3)
    phrase     TEXT,                   -- consumer's mapping phrase
    used_in    TEXT,                   -- optional: where it plays (free text)
    updated_at TEXT,
    PRIMARY KEY (asset_id, consumer)
);

-- What a consumer needs that gold lacks. Open asks only; closed == row deleted.
CREATE TABLE IF NOT EXISTS requests (
    consumer     TEXT NOT NULL,        -- who needs it
    norm         TEXT NOT NULL,        -- normalized phrase (match key)
    phrase       TEXT NOT NULL,        -- display phrase
    used_in      TEXT,                 -- where it would play
    priority     TEXT,                 -- 'high' | 'medium' | 'low'
    constraints  TEXT,                 -- JSON: {max_duration_s, has_music, voice}
    currently    TEXT,                 -- 'tts' | 'placeholder' | 'none'
    note         TEXT,
    fulfilled_by TEXT REFERENCES assets(asset_id),  -- YOU set this on promotion
    created_at   TEXT,
    updated_at   TEXT,
    PRIMARY KEY (consumer, norm)
);
```

## Column ownership (this is the whole contract)

| Table | Consumer writes | Producer writes |
|---|---|---|
| `usage` | every column | — (read-only) |
| `requests` | every column **except** `fulfilled_by` | **only** `fulfilled_by` (+ may append to `note`) |

Disjoint per-column ownership → no write conflicts, no drift. The consumer never
touches `fulfilled_by`; you never touch the rest.

## Lifecycle of a request (replaces the old file back-channel)

1. **Consumer** inserts a row, `fulfilled_by = NULL` → an open ask.
2. **You** promote the clip, mint the `asset_id`, and set
   `requests.fulfilled_by = '<asset_id>'`. That's your reply, in-band.
3. **Consumer** sees `fulfilled_by`, wires the id into `clips.manifest.json`,
   adds a `usage` row, and **deletes the request row**. Closed == gone.

So `fulfilled_by IS NULL` = open worklist; set = "promoted, awaiting consumer to
wire"; row absent = done. No status enum to drift.

## Two things I need from you (the producer)

1. **Persist these tables across `assets.db` rebuilds.** They are *not* derived
   from your sources, so a full regenerate must not drop them. Either rebuild the
   derived objects (`assets`, `asset_tags`, `asset_groups`, `meta`, `catalog`,
   FTS) without touching `usage`/`requests`, or snapshot & restore the two on
   rebuild — same durability guarantee `clip_ids.json` already has.
2. **Enable WAL** so consumer writes and your pipeline reads don't lock each
   other: `PRAGMA journal_mode=WAL;` (persists on the file). The consumer opens
   read-write with `PRAGMA busy_timeout=4000` and short transactions.

## What it buys the curator (query surface)

```sql
-- Who depends on an asset (check before de-curating):
SELECT consumer, dest FROM usage WHERE asset_id = 'asset_035ccb0bf490';

-- Assets nobody uses (curation candidates / safe to drop):
SELECT a.asset_id, a.name FROM assets a
  LEFT JOIN usage u ON u.asset_id = a.asset_id
 WHERE a.published = 1 AND u.asset_id IS NULL;

-- The open request worklist, highest priority first:
SELECT consumer, phrase, priority, used_in, constraints
  FROM requests WHERE fulfilled_by IS NULL
 ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END;
```

An optional convenience view (your call):

```sql
CREATE VIEW IF NOT EXISTS demand AS
  SELECT c.asset_id, c.name, c.norm, group_concat(u.consumer) AS consumers
    FROM catalog c LEFT JOIN usage u ON u.asset_id = c.asset_id
   GROUP BY c.asset_id;
```

## First rows the consumer will write once the tables exist

- `usage`: 9 rows (every clip in `clips.manifest.json`, e.g. `asset_035ccb0bf490`
  → `great_job.mp3`).
- `requests`: 3 open asks — `up`, `down`, `in` (the concept words that complete
  the promoted `out` in your new **Words** group; `constraints`
  `{"max_duration_s":1.0,"voice":"sits with 'out'"}`, priority medium/medium/low).

Say the word when the tables + WAL + durability are in, and I'll run
`scripts/register_demand.py` to populate them and switch the contract over.
