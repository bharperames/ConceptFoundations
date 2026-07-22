# Audio inventory

Every sound the app makes, by section, and whether it comes from **synthesized
speech (TTS)**, a **curated recorded clip** (mp3 from the MR_AudioClips DB), or a
**synthesized tone/SFX** (generated in-app with Web Audio — neither speech nor a
recording).

| Symbol | Kind |
|---|---|
| 🎙️ | Curated clip (recorded mp3, loudness-normalized, from the DB) |
| 🗣️ | TTS — device speech synthesis (`speechSynthesis`) |
| 🎛️ | Synthesized tone / SFX (Web Audio oscillator or noise burst) |

The nine curated clips: `great_job`, `yay`, `hooray`, `we_did_it`, `peekaboo`,
`lets_play_hide_and_seek`, `uh_oh`, `bubble_pop`, `out`. All are acquired from the
producer's **gold** layer by durable `asset_id` (see `audio-clip-contract.md`);
`yay`, `we_did_it`, `peekaboo`, and `out` are kept as committed files pending gold
promotion.

---

## A · Teaching games (Identity, Magnitude, Quantity, Spatial, Composition, Peekaboo)

### A.0 Shared across every level

| Event | Audio | Kind |
|---|---|---|
| Correct answer | random of "Yay!" / "We did it!" / "Hooray!" / "Great job!" | 🎙️ (4 clips) |
| …plus a chime under it | two-note rise | 🎛️ |
| Wrong answer | low buzz | 🎛️ *(Peekaboo overrides — see A.6)* |
| Tap / snap into place | short blip | 🎛️ |
| Level (run) complete | fanfare + "Hooray!" + fireworks finale | 🎛️ + 🎙️ |

### A.1–A.5 Spoken prompts — Identity, Magnitude, Quantity, Spatial, Composition

**All Expose → Contrast → Test narration is 🗣️ TTS.** None of these five nodes
use a recorded clip for their prompts. Examples (representative, one per node):

- Identity 1.2 — "Look. All the same." · "These two are different." · "One is different! Tap the different one."
- Magnitude 2.1 — "Look. Big!" · "And this one is small." · "Tap the big one!"
- Quantity 3.1 — "One apple." · "Look — more!" · "Which side has more?"
- Spatial 4.1 — "The ball is in the box." · "Now the ball is out of the box." · "Put the ball in the box!"
- Composition 5.3 — "Look! A tower of blocks!" · "Oh no, the tower fell down!" · "Stack the blocks! Build a tall tower!"

**Spatial/Composition extra:** block-physics impacts (4.2 On top, 5.3 Tower) play
a 🎛️ wood "clack" SFX on landing.

### A.6 Peekaboo (6.1–6.4) — the only teaching node using clips

| Line / event | Audio | Kind |
|---|---|---|
| Expose: "Let's play hide and seek!" | | 🎙️ `lets_play_hide_and_seek` |
| Contrast: "Peekaboo!" | | 🎙️ `peekaboo` |
| "Watch! The {duck…} is hiding." | | 🗣️ TTS (per object) |
| "Where is the {duck…}? Find it!" | | 🗣️ TTS (per object) |
| Card hides / shuffle | snap | 🎛️ |
| **Wrong stack tapped** | "Uh oh" | 🎙️ `uh_oh` (debounced 1.2s; replaces the buzz) |
| Correct find | reveal + shared praise (A.0) | 🎛️ + 🎙️ |

---

## B · Mini games

### B.1 Bubble Pop

| Event | Audio | Kind |
|---|---|---|
| Intro | "Bubble bubble bubble bubble bubble pop!" | 🎙️ `bubble_pop` |
| "Get ready" countdown (3 · 2 · 1 · Go) | beeps | 🎛️ (snap ×3 + chime) |
| Pop a bubble | soft pop | 🎛️ |
| Round over, score > 0 | "Great job!" | 🎙️ `great_job` |
| Round over, score = 0 | "Uh oh" | 🎙️ `uh_oh` |

### B.2 Picture Puzzle

| Event | Audio | Kind |
|---|---|---|
| Rotate a tile | blip | 🎛️ |
| Puzzle solved | fanfare + "You did it!" | 🎛️ + 🗣️ TTS |

*(Note: "You did it!" is TTS — there's no `you_did_it` clip; the curated praise
clip is "We did it!". A candidate cleanup: reword to "We did it!" to make it 🎙️.)*

---

## C · Finale / celebration (end of a teaching run)

| Event | Audio | Kind |
|---|---|---|
| Run complete | fanfare | 🎛️ |
| | "Hooray!" | 🎙️ `hooray` |
| | fireworks show + trophy/ribbon | (visual) |

---

## D · UI / dashboard / level map / volume

**Silent.** No audio on the home screen, level map, level picker, grown-up
dashboard, or the volume control itself (it only scales everything above).

---

## Summary

- **Curated clips carry the emotional beats** — all praise on correct answers,
  the run-complete "Hooray!", the Peekaboo intro/peekaboo/uh-oh, and both
  Bubble-Pop outcomes. 9 clips, each normalized to ~−13 LUFS to match the voice.
- **TTS carries the instructional content** — every Expose/Contrast/Test prompt
  across five of six nodes, plus Peekaboo's per-object "Where is the …?" lines
  and Picture Puzzle's win. This is the bulk of spoken words and the biggest
  opportunity if we want to curate more (e.g. record the recurring prompts).
- **Synth tones carry mechanical feedback** — taps, snaps, wrong buzz, block
  clacks, bubble pops, countdown beeps, fanfare.

**Consolidated:** a single `uh_oh` clip (the gold 0.83s "Uh Oh") now serves both
the Bubble-Pop game-over and the Peekaboo wrong-tap — the two earlier "uh-oh"
clips were merged in the gold migration.
