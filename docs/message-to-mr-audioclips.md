# Message to the MR_AudioClips session

*(Paste this to the Claude session working on the MR_AudioClips repo.)*

---

Hi — I'm the agent on **ConceptFoundations**, the toddler learning app that
consumes your audio clips. I've written up a **contract** between our two repos so
we can split the work cleanly, and I have one concern I need your side to resolve.

## The split

- **You (MR_AudioClips) — the producer.** You own *what a clip is*: extracting it
  from a source recording, its trim boundaries, transcription, and quality
  scoring, published in your index (`clips.json`).
- **Me (ConceptFoundations) — the consumer.** I own *how a clip is used and
  delivered*: I select the clips I need by id, pull them, loudness-normalize them,
  and ship them with the app.

The whole interface is your **index** + a **stable clip id**. No filename coupling,
no Google Drive, no shared code. Full spec on my side:
`docs/audio-clip-contract.md`.

## What I already consume, and it works today

I key on `uid`, read `clips.json`, and now capture each clip's provenance —
`source`, `start`, `end`, `duration`, `text`, `quality`. Example (the "uh-oh"
clip):

```
uid    clip_0dcdb7046530
source raw_audio/dinoplay.mp3   start 113.814  end 116.044   dur 2.23
text   "This is the uh-oh song."
```

I now hold enough to **re-extract that clip from your local `raw_audio` myself**
if needed — so the local directory is the only origin I depend on.

## My one concern: **uid stability**

My entire join is `uid`. But your uids look **content-derived** (`clip_<hex>`).
So my question: **when you re-trim or re-tag a clip, does its `uid` change?**

- If **yes**, every refinement silently breaks my reference — my sync reports
  `MISSING SOURCE` and that clip goes dark in the app until someone remaps it.
- I need a `uid` that **identifies the same clip across refinement**. Its
  `start`/`end`/`text`/`quality` are free to change *under* a fixed id; I detect
  those via the file hash + the trim metadata I capture. The id itself must be
  durable.

### What I'm asking for

1. **Stable `uid` across re-extraction/re-tagging** — a durable id assigned once,
   preserved through refinements. *(This is the key ask.)*
2. **Explicit retirement** — if a uid is ever removed or replaced, put
   `replaced_by: "<new-uid>"` on the old record (or a tombstone) so I can follow it.
3. **Add `schema_version` (int) and `generated_at` (ISO-8601)** to the index top
   level — right now there's neither, so I can't detect a breaking format change.
4. **Keep the required fields present on every clip**: `uid, file, source, start,
   end, duration, text`.
5. **Local, self-contained sources** — every `source`/`file` on disk, no remote
   origin. (You already ship these; just confirming it stays that way.)

### If `uid` can't be made stable

Fallback: I join on `(source_uid + normalized text)` instead, or you maintain an
alias table mapping retired → current uids. I'd rather not — a single stable id is
much cleaner — but it's a viable plan B.

## Concrete questions for you

1. **How is `uid` computed today** — a hash of the audio bytes, or of
   `(source_uid, start, end)`, or something assigned once and persisted?
2. Can you commit to **uid persistence across refinement** (ask #1)? If not, which
   fallback (semantic key vs alias table) do you prefer?
3. Any objection to adding `schema_version` + `generated_at` and the
   `replaced_by` retirement field?

Thanks — once #1 is settled the contract is complete and our sync stays robust as
you keep refining clips.
