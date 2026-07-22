# Curriculum expansion plan — reasoning layer

Four new nodes that carry the app from *perception/comparison* into *reasoning*:
**Causality, Seriation, Sorting, and Patterns (What Comes Next).** Each is
designed in the app's existing shape — Expose → Contrast → Test(×3) → Generalize,
strict variable isolation, DDA repair, seeded procedural generation — and reuses
mechanics already built (tap, drag, zones, the block-physics engine, the
extracted card art).

Legend for "reuses": **tap** (tap-target trial), **drag** (drag-to-slot),
**zone** (drop containers), **physics** (block-stacking sim), **cards**
(assets/cards/\*.webp), **new** (new engine/art work).

---

## Node 7 · Causality — "make it happen"

**Primitive:** action → effect (contingency, means-end, cause discrimination).
The single biggest gap and the highest-value add. Anchored on the **block-physics
sim** as you suggested — the pieces already fall, topple, and scatter realistically.

**Prerequisite:** Spatial (shares the physics/drag surface).

| Micro-level | Focus | Test-state mechanic | Fallback | Reuses |
|---|---|---|---|---|
| **7.1 Contingency** | my action makes it happen | A tower stands. "Make it fall!" — **tap** the tower → a sideways impulse topples it (physics). *Any* tap on it works (errorless — the point is action→effect). | Auto-nudge it slightly to invite the tap. | physics + **new** (tap-impulse) |
| **7.2 Means–end** | the action must be aimed | "Knock it down!" — **drag** a ball and let go toward the tower; release velocity knocks it over. Only hitting it works. | Widen the hit radius / auto-demo the throw. | physics, drag |
| **7.3 Which cause?** | discriminate the effective cause | Two controls (e.g. a lever and a rock). "Which one makes it go?" — **tap** the one that triggers the effect; the other does nothing. | Pulse the working control. | tap + **new** (control art) |
| **7.4 Chain / indirect** | effect can be one step removed | Tap the first domino → the row falls; or pull the string → the bell drops. Cause is indirect. | Show the chain once, slowly. | physics + **new** |
| **7.5 Generalization** | transfer "action→effect" | New pair: place the spider on the pipe → water flushes it out (the backlog idea); or press the button → the light comes on. | Glow the cause. | **new** art + drag/tap |

**New engine work:** a *tap-impulse* on a standing stack (inject horizontal
velocity → the existing topple math takes over); a tiny collision for the
thrown-ball case (ball overlaps block → impulse); simple two-state "controls"
(lever/button) with a scripted effect; the spider/pipe/water animation.

**Why it matters:** contingency is the root of agency and of every later
"if I do X, Y happens." It's also intrinsically motivating — toddlers *love*
knocking things down, and here the knock-down *is* the lesson.

---

## Node 8 · Seriation — "order by size"

**Primitive:** arrange 3+ items along a dimension (small → big). Extends
Magnitude from *pairwise* judgement to *ordering*.

**Prerequisite:** Magnitude.

| Micro-level | Focus | Test-state mechanic | Fallback | Reuses |
|---|---|---|---|---|
| **8.1 Two in order** | small vs big into 2 slots | A row of 2 size-graduated slots (a staircase). **Drag** each shape to its slot, small→big. | Snap the correct slot magnetically. | drag, zone |
| **8.2 Three in order** | small–medium–big | 3 graduated slots; drag all three into ascending order. | Lock the two extremes, leave the middle. | drag, zone |
| **8.3 Insert into order** | relative magnitude | Small and big already placed; a medium is given — **drag** it to the gap between them. | Flash the correct gap. | drag, zone |
| **8.4 No staircase** | judge order without the guide | 3 slots, equal size (no visual scaffold) — the child must judge. | Fade the staircase guide back in. | drag, zone |
| **8.5 Generalization** | order by size, new objects | Nesting cups / animals (elephant→cat→duck) small→big. | Mute non-target cues. | drag, zone, cards |

**New engine work:** ordered-slot frame with per-slot correctness (the drag/zone
plumbing exists; this adds a slot-index target). Optional "staircase" scaffold art.

---

## Node 9 · Sorting / Classification — "put the same ones together"

**Primitive:** group by a shared property, and — crucially — **recognize
non-members**. Bridges Identity → categorization → class-inclusion.

**Prerequisite:** Identity.

| Micro-level | Focus | Test-state mechanic | Fallback | Reuses |
|---|---|---|---|---|
| **9.1 Sort by color** | one property, two groups | Two bins (red, blue). **Drag** each item to its color bin. | Gray out the wrong bin while dragging. | drag, zone |
| **9.2 Sort by shape** | shape (color varies) | Two bins by shape; color is a distractor — forces the abstraction. | Drop back to a single deciding cue. | drag, zone |
| **9.3 Sort by kind** | semantic category | Animals → the pen, vehicles → the road. Category, not surface feature. | Pulse the correct destination. | drag, zone, cards |
| **9.4 Include & exclude** | membership + non-membership | **"Put all the piggies in the pen"** — drag only the animals in; **leave out** the tractor, the farmer, the crayons. Dragging a non-member is gently refused. | Dim the non-members so the members pop. | drag, zone, cards |
| **9.5 Generalization** | new categories | Things that fly vs things that swim; fruit vs toys. | Glow one correct exemplar. | drag, zone, cards |

**The exclusion level (9.4) is the important one** — recognizing what *doesn't*
belong is a distinct logical act (class-inclusion / negation) and is exactly your
"little piggies in the pen, leave out the tractor" example. The extracted card
set already has the pieces: animals (pig-adjacent: rabbit, dog, cat, duck,
elephant, frog, bear, horse) vs vehicles (car, train, tricycle, airplane,
rocket) vs other (crayons, keys, ball) — enough to build real categories and
real non-members. *(A pig sprite would be a nice add for the literal "piggies.")*

**New engine work:** a "reject" response when a non-member is dropped in a bin
(bounce back + soft no), and success = all members binned *and* non-members left
out. Otherwise it's the existing drag/zone.

---

## Node 10 · Patterns — "what comes next"

**Primitive:** infer a rule from a partial sequence and **extrapolate** it. Your
framing is the right one, so the node is split along it:

> A toddler can't *produce* the next item, so they **choose from alternatives** —
> given a 2–3 item sequence, which of the choices is the next one? It's
> similarity-matching with an extra step: inferring the sequence's underlying
> logic, not just matching a sample.

This makes Patterns a **tap trial** (choose the correct option) — it drops
straight onto the existing tap engine; the "target" is just computed from a rule
instead of from a sample.

**Two variants, exactly as you called them:**

- **Known-order sequences (extrapolation over a familiar dimension).** The rule is
  a dimension the child already knows (size, quantity). "Pick the next biggest."
  This is close to seriation/sorting — the answer exists in a known ordering.
- **Abstract sequences (rule inference).** The rule is a *relation* the child must
  read off the sequence itself (AB alternation, ABC cycle, growth). Harder; leans
  on genuine inference.

**Prerequisite:** Identity + Seriation.

| Micro-level | Focus | Test-state mechanic | Fallback | Reuses |
|---|---|---|---|---|
| **10.1 Next biggest** *(known order)* | extrapolate a known dimension | Show small → medium in a row with a "?" slot; **tap** the next-bigger from 2–3 choices below. | Remove one wrong choice (2-way). | tap |
| **10.2 AB repeat** *(abstract)* | simplest rule | red, blue, red, blue, **?** → tap the choice that continues it. | Highlight the repeating unit. | tap |
| **10.3 AAB / ABC** *(abstract)* | longer rule | red, red, blue, red, red, **?**; or ▲ ■ ● ▲ ■ **?** → tap the fitting choice. | Replay the sequence, slower. | tap |
| **10.4 Growing / semantic** *(abstract)* | rule with meaning | 1, 2, 3 dots → tap the "4"; or seed → sprout → **?** → tap the flower. | Drop to a 2-choice. | tap, cards |
| **10.5 Generalization** | new rule types / objects | mixed pattern types with unfamiliar exemplars. | Glow the correct choice. | tap, cards |

**New engine work:** a "sequence row + ? slot + choice tiles" layout (a tap trial
where the target is the choice matching the rule), and small generators for AB /
AAB / ABC / size / quantity rules. The extrapolation logic is just: build the
sequence from a rule, compute the correct next item, and offer it among
distractors — the tap-target plumbing already exists.

**Why it matters:** "what comes next" is the first *predictive inference* — the
child stops describing what is and starts predicting what will be. That's the
hinge from perception into reasoning.

---

## Sequencing & prerequisites

```
Identity ─┬─► Classification (9) ─┐
          │                       ├─► Patterns (10)
          ├─► Magnitude ─► Seriation (8) ─┘
          ├─► Quantity
          ├─► Spatial ─► Causality (7)
          ├─► Composition
          └─► Peekaboo
```

- **Seriation (8)** needs Magnitude; **Sorting (9)** needs Identity; **Patterns
  (10)** builds on both (extrapolation = ordering + matching); **Causality (7)**
  slots off Spatial to inherit the physics surface.
- Rough developmental order to *introduce* them: Sorting → Seriation → Causality
  → Patterns (patterns last — it's the most inferential).

## Implementation phasing (when you greenlight build)

1. **Causality 7.1–7.2** first — highest value, and the physics is already there
   (tap-impulse + thrown-ball). One node, immediate payoff.
2. **Patterns** — cheapest to build (pure tap trials + rule generators), high
   pedagogical return.
3. **Sorting** — mostly drag/zone + a reject response; card assets ready.
4. **Seriation** — ordered-slot frame.
5. Backfill the generalization levels and the richer causality (chain, spider).

Each node ships behind the same telemetry, so the **generalization-transfer rate**
tells us whether the child acquired the *concept* (e.g. real rule inference) vs.
memorized a particular sequence — the same rote-vs-concept check the app already
makes elsewhere.

## Small asset/engine adds this implies

- Causality: tap-impulse on stacks; ball↔block collision; lever/button controls;
  spider/pipe/water.
- Sorting: bin "reject" response; a pig sprite (nice-to-have for the literal pen).
- Seriation: ordered-slot frame + optional staircase scaffold.
- Patterns: sequence-row layout + rule generators (AB/AAB/ABC/size/quantity).

Nothing here needs a new interaction paradigm — it's the existing tap, drag,
zone, and physics, recombined. That's what makes this expansion cheap relative to
its pedagogical value.
