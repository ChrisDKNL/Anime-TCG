# Pack opening: the ceremony

Cross-cutting (the manager adds the roadmap row) · owner decision [ADR 0014](../adr/0014-slot-style-pack-opening.md), option C (2026-10-31: "Go with C, I want the slot feel") · its pieces (card back, sleeves, type, colours, tokens) are in `visual-identity.md` · replaces the reveal entrance of `packs-page.md` §3.4 step 6 and its page layout on the opening pages, keeps everything else of `packs-page.md` §3.3–§3.7, `market-and-shop.md` §3.3 step 6 and `navigation-and-landing.md` §3.13–§3.14 · security tier **T3** for its build PR (ADR 0014 Consequences: C1, C20, truthful tells) · written 2026-10-31 · mockup (private claude.ai artifact, `docs/mockups/pack-opening/`): [pack opening](https://claude.ai/artifact/Qg7szqQYhsKyXcwQYtJTp7); the page mockup is [redesign pages](https://claude.ai/artifact/MGFEYGyE3ZsWqiQ4MrS1eH)

**What this spec does not repeat.** Opening a pack still works exactly as today: the button and its guards, the `requestId` and its retry, every answer without cards, the push to the opening page, Back, Forward, reload, the newest-request-wins rule, the collection refetch and the shop's confirmation. They are in `packs-page.md` §3.3, §3.7, §4.1, `market-and-shop.md` §3.3 and `navigation-and-landing.md` §3.13, §3.14. This spec starts where those end, **when the server's answer with five cards is held**. It says how those five cards are shown.

## 1. Goal

Opening a pack should feel like pulling a lever. The pack appears as an object. You hold to tear it open. The cards wait face down, and you turn them one at a time. Before a card turns, its back lights up in its tier's colour and star count. An Epic or rarer card gets a full-screen moment with its series. Then comes a summary of the whole pack. Every bit of suspense is honest: the server has already dealt the whole pack before the first frame, and every tell shows the card's real tier, never a higher one. The player can get out at any moment with `Reveal all`. Sound is off until they turn it on, and reduced motion gets a short version. The same ceremony runs for the timer pack (`/packs/open`), shop packs (`/shop/open`) and the public demo (`/demo`).

## 2. Out of scope

- **Opening several packs at once** (kyara's ×5, ×9). `POST /api/packs/open` and `POST /api/shop/buy` each deal one pack, and there is no batch endpoint. Opening several would need either a new contract (T3) or a run of single requests, each with its own `requestId` and answer handling. Neither is designed here. The summary's `Open pack` opens the next one.
- **Series art in the spotlight.** `FranchiseRef` carries a title, a native title and a start year, but no image. The spotlight (§6) uses the character's own art. A series cover would need the snapshot to store one and the API to send it: a server change for a later spec.
- **A Karma estimate for duplicates** ("+z Karma if recycled"). `isNew: false` means the account already had _this character_, at any tier. It does not mean the card is a recyclable duplicate: a recyclable duplicate is a second copy of the same character, tier and variant (`CollectionEntry.recyclable`). `PackOpened` carries no recyclable count, so any number shown would be a guess. The summary says `Already yours` and points to the collection, where recycling lives. A per-card `recyclable` flag on `PackOpened` would be a contract change for the manager.
- **A shareable result page** (`/packs/<id>`, `navigation-and-landing.md` §2), a best-card highlight on the summary, haptics and vibration, autoplay (the ceremony never turns a card by itself, §4.4), and remembering the sound setting across reloads (no storage, §11).
- **The pack sheet on `/packs`, the sleeves and the card back as drawings.** They are `visual-identity.md` §7, §8 and §11.3. This spec uses them.

## 3. The rules (ADR 0014, binding)

1. **The server decides first.** The ceremony starts only once the answer with five cards is held. It reads `PackOpened` (timer pack), `ShopReceipt.pack` (shop) or `DemoOpened` (demo) and nothing else. It rolls nothing, computes no outcome, reorders nothing (slot order, 0 to 4) and sends no request (C1, C20).
2. **Every tell is true.**
   - A card back lights exactly as many sockets as its granted tier has stars (`OpenedCard.rarity`), and the rim and glow are that tier's colour.
   - A sleeve lights the floor its rules guarantee (`visual-identity.md` §8.1), from the answer's `packKind` and `pityMythic` and the held odds.
   - A spotlight plays only for a card whose tier is Epic, Legendary or Mythic, and it names that tier.
   - The tier word, the sound cue and the stage tint all name the same tier as the card.
   - Nothing ever shows a tier higher than the card's. Nothing builds up step by step from a lower tier to the real one, because a climb that stops reads as "almost". There is no near-miss, no fake "almost Mythic", and no slowdown that happens only on a miss.
3. **Same tempo for every tier up to the turn.** The time from a card becoming current to the moment it can be turned is the same for every tier. So are the flip's duration and the input lock (§4.3). Higher tiers get **more after the turn** (the spotlight). They never get a delay before it.
4. **The player can always get out.** `Reveal all` and `Skip` are on screen and in the tab order in every ceremony state (S1–S6). Escape is `Reveal all`. Leaving the page loses nothing.
5. **Quiet by default.** Sound is off until the player turns it on, every time the app loads. There is no "don't ask again", "don't warn me again" or "skip the confirmation" anywhere: the shop's spend confirmation stays as it is (`market-and-shop.md` §3.3, ADR 0014 §4).
6. **No nags.** There are no streaks, timers, "open your next pack" prompts or pulsing reminders. The summary's `Open pack` is an ordinary button with the count line next to it (ADR 0004 §6).

## 4. Flow: the state machine

The ceremony is a pure reducer, `ceremonyReducer(state, event, context)` in `web/src/lib/ceremony.ts`. Its context holds the held answer's cards and pack flags and whether motion is reduced. The stage component renders the state, and timers send `ANIM_END`. The reducer has no randomness and no I/O.

### 4.1 States

| #   | State          | What the player sees                                                                                                                                                                                                                                                                                                                                                  | Ends when                                                                                                |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| S0  | `awaiting`     | The stage with the standard sleeve at 60 % opacity, its floor sockets lit (Rare, 3). The prompt is replaced after 300 ms by `Waiting for the server…`, and after 10 s it adds the still-waiting line (§10). The stage control is `aria-disabled`. `Skip` and `Reveal all` are not shown yet, because nothing has been dealt to show. The tray shows five empty slots. | the answer: with cards → S1; without cards → the existing paths (`packs-page.md` §3.7 step 6; demo §4.9) |
| S1  | `sealed`       | The sleeve for this answer (`visual-identity.md` §8.2), at full opacity. Its sockets rise to the answer's floor if it is higher (Enchanted 4, Radiant or pity 6) over `--stage-tell-in`, and the kind mark appears. Prompt `Hold to tear it open`.                                                                                                                    | tear complete, or a single-press tear (§4.3), or `Skip` / `Reveal all`                                   |
| S2  | `tearing`      | The Volt tear line grows along the seam over `--stage-tear-hold` (700 ms) while held.                                                                                                                                                                                                                                                                                 | release (→ S1, the line unwinds over 150 ms) or complete (→ S3)                                          |
| S3  | `bursting`     | The seam strip lifts off and fades (200 ms). The sleeve drops and fades while five card backs rise out, 60 ms apart, and settle into a stack (450 ms). `--stage-burst` is 650 ms in total.                                                                                                                                                                            | `ANIM_END`, tap, `Skip` → S4(0)                                                                          |
| S4  | `faceDown(i)`  | Card `i` on top of the stack, showing its **tell** (`visual-identity.md` §7.2) over `--stage-tell-in`. Counter `i+1 / 5`. Prompt `Tap to turn`. The tray shows the turned cards as thumbnails and the rest as empty slots. It waits for the player and never turns by itself.                                                                                         | the player turns it → S4f(i)                                                                             |
| S4f | `flipping(i)`  | The card turns over its vertical axis (`--stage-flip`, 360 ms, `ease-snap`). The back hides at 90°, then the face shows. The face enters the DOM when S4f starts (§12 item 3). For Epic and up (full motion), the flip is replaced by S5.                                                                                                                             | `ANIM_END` → S6(i)                                                                                       |
| S5  | `spotlight(i)` | Epic, Legendary and Mythic only, full motion only: the full-screen moment (§6), for `--stage-spotlight-<tier>`.                                                                                                                                                                                                                                                       | `ANIM_END`, tap, `Skip` → S6(i)                                                                          |
| S6  | `faceUp(i)`    | The card face up at stage size with every frame effect (`card-and-rarity.md` §5.3, "in the reveal always"). It settles over 250 ms. Under it: the tier word, the name, the series and the `New` or `Already yours` marker (§7.3). Tray slot `i` fills with the thumbnail. Prompt `Tap for the next card` (last card: `Tap to see your pack`).                         | the player advances → S4(i+1), or S7 after card 4                                                        |
| S7  | `summary`      | The stage fades out (200 ms) and the page shows the pack's summary (§8). Not-yet-turned cards flip in their grid slots, 60 ms apart; already-turned cards are just there.                                                                                                                                                                                             | terminal                                                                                                 |

### 4.2 Events and transitions

`·` means the event does nothing in that state. Every row with `REVEAL_ALL` → S7 is required by rule 4.

| Event ↓ / State →                       | S0                                                | S1                             | S2          | S3    | S4(i)                                     | S4f(i) | S5(i) | S6(i)                     | S7  |
| --------------------------------------- | ------------------------------------------------- | ------------------------------ | ----------- | ----- | ----------------------------------------- | ------ | ----- | ------------------------- | --- |
| `ANSWER` (with cards)                   | S1                                                | ·                              | ·           | ·     | ·                                         | ·      | ·     | ·                         | ·   |
| `HOLD_START` (pointer down)             | ·                                                 | S2                             | ·           | ·     | ·                                         | ·      | ·     | ·                         | ·   |
| `HOLD_END` (up, cancel, leave)          | ·                                                 | ·                              | S1 (unwind) | ·     | ·                                         | ·      | ·     | ·                         | ·   |
| `HOLD_DONE`                             | ·                                                 | ·                              | S3          | ·     | ·                                         | ·      | ·     | ·                         | ·   |
| `PRESS` (single-press tear, §4.3)       | ·                                                 | S3                             | S3          | ·     | ·                                         | ·      | ·     | ·                         | ·   |
| `ADVANCE` (tap, Space, Enter, →, swipe) | ·                                                 | · (shows `Keep holding`, §4.3) | ·           | S4(0) | Epic+ and full motion: S5(i); else S4f(i) | ·      | S6(i) | i < 4: S4(i+1); i = 4: S7 | ·   |
| `ANIM_END`                              | ·                                                 | ·                              | ·           | S4(0) | ·                                         | S6(i)  | S6(i) | ·                         | ·   |
| `SKIP`                                  | ·                                                 | S4(0) (no burst)               | S4(0)       | S4(0) | as `ADVANCE`                              | S6(i)  | S6(i) | as `ADVANCE`              | ·   |
| `REVEAL_ALL` (button, Escape)           | ·                                                 | S7                             | S7          | S7    | S7                                        | S7     | S7    | S7                        | ·   |
| `LEAVE` (the page unmounts)             | the request goes on (`packs-page.md` §3.3 step 5) | the opening is marked shown    | same        | same  | same                                      | same   | same  | same                      | ·   |

- **Marked shown**: once S1 has been entered, the opening counts as having had its entrance (`navigation-and-landing.md` §3.13 step 12, "An entrance plays once per pack"). Coming back by Forward, `See your latest pack` or `See your latest shop pack` shows **S7 without animation**. The ceremony never replays.
- **An answer that lands while the page is not showing** (§3.3 step 5 there) never starts the ceremony. The first showing is S7 without animation.
- **`Open pack` in S7** (timer pack, `/packs/open`) starts the next opening on the same page, as today: same guards, same key. The stage opens again in S0. The previous summary stays under it with `aria-busy` until the answer, and goes if the answer has no cards (`packs-page.md` §3.7 step 6).

### 4.3 Inputs

| Input                                      | Where                   | Does                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hold** (pointer down, any pointer type)  | the stage control in S1 | `HOLD_START`. `pointerup`, `pointercancel` or `lostpointercapture` before 700 ms → `HOLD_END`. 700 ms held → `HOLD_DONE`. The control has `touch-action: none`, `user-select: none` and `-webkit-touch-callout: none`, and suppresses `contextmenu`, so a long press does not scroll or open a menu.         |
| **Short press** (pointer up before 700 ms) | S1                      | `HOLD_END` as above, and the prompt reads `Keep holding` for 1.5 s. It is a hint, not a nag: it shows once per press and never by itself.                                                                                                                                                                    |
| **Single-press tear** (`PRESS`)            | S1, S2                  | Enter or Space keydown on the stage control (not `repeat`), or a `click` whose `detail` is 0 (assistive tech and keyboard). Under reduced motion, any press or click on the stage control. All of them tear at once, without a hold.                                                                         |
| **Advance** (`ADVANCE`)                    | S3–S6                   | a click or tap on the stage control (`detail` 1 only), or in S5 anywhere on the spotlight layer (§6); Enter or Space on it; → (ArrowRight) while focus is on the stage control; a swipe left or up of at least 48 px that starts on the stage. A tap always works too, so no gesture is needed (WCAG 2.5.1). |
| **Skip** (`SKIP`)                          | S1–S6                   | the `Skip` button                                                                                                                                                                                                                                                                                            |
| **Reveal all** (`REVEAL_ALL`)              | S1–S6                   | the `Reveal all` button; Escape anywhere on the page                                                                                                                                                                                                                                                         |
| **Back**                                   | any                     | the top bar's back link, or the browser's Back: `LEAVE`                                                                                                                                                                                                                                                      |

Guards (the existing double-activation rules, `packs-page.md` §3.3 step 2, applied to the stage):

- A click with `detail` above 1 and a keydown with `repeat` true are ignored, so a double tap or a held key is one step.
- **The click that ends a hold is ignored.** A `click` whose `pointerdown` sent `HOLD_START` is never an `ADVANCE` or a `PRESS`, whatever the hold's length. Without this, a hold past 700 ms reaches S3, and the click on release sends `ADVANCE` and skips the burst. A short press already has its effect from `pointerup` (`HOLD_END`, `Keep holding`).
- **Input lock**: after each state change, `ADVANCE` and `SKIP` are ignored for 150 ms, the same for every state and every tier (rule 3). One fast tap then cannot both turn a card and skip its face. `REVEAL_ALL` is never locked.
- One element, one listener: the stage control handles pointer and key events. The page-level Escape handler is the only global key, and it does nothing outside S1–S6.

### 4.4 Timings (full motion)

| Segment                                 | Duration                                            | Same for every tier?                                     |
| --------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| sleeve in (S0 → visible)                | 320 ms                                              | yes                                                      |
| sockets rise to the answer's floor (S1) | 250 ms                                              | yes (the sleeve's floor is a pack fact, not a card tier) |
| hold to tear                            | 700 ms (player-controlled)                          | yes                                                      |
| burst                                   | 650 ms (skippable)                                  | yes                                                      |
| tell in (S4)                            | 250 ms, then waits for the player                   | **yes** (rule 3)                                         |
| input lock after each state change      | 150 ms                                              | **yes**                                                  |
| flip (Common, Uncommon, Rare)           | 360 ms                                              | —                                                        |
| spotlight (Epic / Legendary / Mythic)   | 1.4 s / 2.0 s / 2.6 s, skippable, replaces the flip | no: more after the turn (ADR 0014 §1)                    |
| settle (S6)                             | 250 ms                                              | yes                                                      |
| stage out, summary in (S7)              | 200 ms; unturned cards flip 60 ms apart             | yes                                                      |

A player who taps through five Commons as fast as the lock allows spends about 0.3 + 0.7 + 0.65 + 5 × (0.15 + 0.36 + 0.15) + 0.2 ≈ 5.2 s. With `Reveal all` it takes one press. The numbers live in one typed module, `web/src/lib/ceremonyTimings.ts`, and the CSS tokens of `visual-identity.md` §12.6 must match it (§14 unit test).

### 4.5 Reduced motion (`prefers-reduced-motion: reduce`)

The same states and the same controls, without movement:

- S0 and S1: the sleeve is there at once and its sockets change without transition. **One press tears**: no hold and no tear line (§4.3).
- S3 is skipped: S1 → S4(0) directly.
- S4: the tell is static. Sockets and rim are lit, and the glow is shown as a still image. There is no `tell-breathe` and no pearl drift (`visual-identity.md` §7.2).
- S4f: no rotation. The face replaces the back at once.
- **S5 never plays.** In S6, an Epic, Legendary or Mythic card instead gets the **static banner**, inside the info block under the card (§7): the tier word takes the `section` size in the tier's text colour, and the series line reads `Series · <title>`. It has no timer and no overlay, and it adds 3 px to the info block.
- S6: no settle; the frame's glint and drift are off (`card-and-rarity.md` §5.3); the glow is still shown.
- S7: no stage fade and no flips in the grid.
- Sound cues still play if the player turned sound on. Sound is not motion.

The reduced path is the full ceremony's information in order: sleeve, tell, card, summary. Nothing is hidden by it.

## 5. The tell and the per-tier treatment

| Tier      | Face down (S4): sockets, rim, glow (`visual-identity.md` §7.2) | Stage tint (`--stage-tint`, a radial at the centre)     | Turn            | Face up (S6)                                               | Sound cue (if on, §11)  |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------- | --------------- | ---------------------------------------------------------- | ----------------------- |
| Common    | 1, grey rim, no glow                                           | none                                                    | flip            | card, settle                                               | `turn`                  |
| Uncommon  | 2, teal rim, no glow                                           | none                                                    | flip            | card, settle                                               | `tell-2`, `turn`        |
| Rare      | 3, blue rim, soft glow                                         | none                                                    | flip            | card, settle                                               | `tell-3`, `turn`        |
| Epic      | 4, ruby rim, frame glow, breathing                             | ruby at 14 %                                            | spotlight 1.4 s | card with glint; tint stays until `ADVANCE`                | `tell-4`, `spotlight-4` |
| Legendary | 5, topaz rim, frame glow, breathing                            | topaz at 14 %; the stage's star layer brightens to 60 % | spotlight 2.0 s | card with glint; tint and stars stay until `ADVANCE`       | `tell-5`, `spotlight-5` |
| Mythic    | 6, pearl rim drifting, frame glow, breathing                   | lavender at 18 %; stars brighten to 70 %                | spotlight 2.6 s | card with pearl drift; tint and stars stay until `ADVANCE` | `tell-6`, `spotlight-6` |

- At rest, the stage's star layer is at 40 % opacity.
- The tint and star brightening fade in with the tell (250 ms) and fade out over 200 ms on the next `ADVANCE`. Under reduced motion they switch without transition.
- **Only the current card shows a tell.** The cards beneath are plain backs. A card's tell is rendered only when it becomes current (§12).
- **No confetti, particles or shaking.** The extra motion is light: tint, glow and stars. The standards' bans on confetti, sparkle motifs and floating blobs stay in force inside the stage.
- **Special packs** (Enchanted, Radiant, pity) get their truth on the sleeve (S1: kind mark and floor sockets) and their explanatory line in the summary (`card-and-rarity.md` §7.1). Their cards get exactly the treatment of their own tiers. A Radiant pack's five Epic-or-better cards each get their spotlight, which is a lot of ceremony. That is true to the pack, and `Reveal all` is one press away.

## 6. The spotlight (S5)

A full-screen layer over the stage (`position: fixed; inset: 0`), the stage background with the tier tint at double strength (Epic 28 %, Legendary 28 %, Mythic 36 %). It fades in over 150 ms, inside its duration. A tap or click anywhere on the layer is `ADVANCE` (§4.2: S5 → S6), with the same `detail`, hold and lock guards as the stage control (§4.3). Focus stays on the stage control under it, so Enter, Space and → still work. On that tint every small text in the spotlight uses `ink-300`, never `ink-400`. Worst case at the tint's centre: `ink-300` 5.91 (Mythic), 6.60 (Legendary), 8.86 (Epic). The tier word is large text and needs 3:1: Epic 4.28, Legendary 6.24, Mythic 4.36.

Top to bottom, left-aligned in the 16 px gutter, centred in a 560 px column from `sm`:

1. Eyebrow `Card <i> of 5` (mono, `ink-300`).
2. **The tier word**: `Epic`, `Legendary` or `Mythic` in the `tier-word` style (`visual-identity.md` §4.2), uppercase, in the tier's text colour (`--color-rarity-<tier>-text`). It is large text, at least 5.76:1 on `night-950`. It is solid colour, never gradient text. It enters by scaling from 1.08 to 1 with opacity 0 → 1 over 300 ms.
3. **Series block**, 24 px under it. From 360 px it is two columns: the **art** at 120 × 160 (3:4, `object-fit: cover`, `object-position: center top`) in a 3 px frame of the tier's flat colour, `radius 8px`; beside it, the eyebrow `Series`, the series title (`franchiseIds[0]` through the answer's `franchises`) at `section` size, at most 3 lines, `dir="auto"`, the native title under it in `small` `ink-300` when present, and `<startYear>` in `num` `ink-300` when present. Under 360 px the art sits above the text at 96 × 128.
4. `Popularity #<rank> of <pool>` in `num` `ink-300`: `character.rank` over the held pool size (`card-and-rarity.md` §6.2: `odds.snapshot.characterCount` for the timer pack, `ShopResponse.snapshot` for the shop, `GET /api/demo` for the demo; without it `Popularity #<rank>`; with no rank the line is left out).
5. At the bottom, the stage's own `Skip` and `Reveal all` stay where they are (§7), above the layer.

The spotlight names no character: the name arrives with the card in S6. It reads only fields the answer already carries. Under reduced motion it is replaced by the S6 banner (§4.5).

## 7. Layout: the stage

The stage is the opening page's content from S0 to S6: a `fixed inset-0` layer at `z-40`, `min-h-dvh`, with `--stage-bg`. While it shows, the site header and the phone tab bar are hidden (`inert` and `hidden`). The page's `<main>` still holds the `h1`, now inside the stage's top bar. In S7 the stage is gone and the page shows its normal header, tab bar and summary.

**Top bar**, 56 px, `px-4`. Its parts:

- the back link (`Back to packs`, `Back to the shop`, `Back to the landing page`): a `ChevronLeft` icon, plus the text from 640 px;
- the `h1` (`Pack opening`, `Shop pack`, `Demo pack`) in the `eyebrow` style (11 px on a phone, 12 px from `sm`), `ink-300`. It is still the page's `h1` and focus target (`navigation-and-landing.md` §3.6). Under it, from S4 on, the counter `1 / 5` in `num`;
- the source's chip (timer pack: `Packs ready`; shop: `Karma`, with the receipt's balance; demo: none, `visual-identity.md` §10.2);
- the sound toggle (§11), a 44 px icon button (`Volume2` or `VolumeX`), with a visible label from `sm`.

Their layout:

- **Below 640 px**: one flex row, nothing centred. The back link is a 44 × 44 icon button: its text is visually hidden, and the link keeps it as its name. Then, 4 px on, the `h1` and counter, left-aligned, `flex-1 min-w-0`. Then the chip, and 8 px on, the toggle. Below 360 px the Karma chip drops the word `Karma` visually, as in the header (`visual-identity.md` §10.3). The `h1` never truncates; the longest, `Pack opening`, is about 107 px. Widest case at 320 px (timer pack): 44 + 4 + 107 + 8 + 62 (chip) + 8 + 44 = 277 of 288 px. At 390 px the widest is the shop with the word `Karma`: 44 + 4 + 80 + 8 + 103 + 8 + 44 = 291 of 358 px.
- **From 640 px**: a three-column grid (`1fr auto 1fr`). The back link with its text is on the left. The `h1` and counter are centred. The chip and the labelled toggle are on the right, 8 px apart. At 640 px each side column is about 230 px, and the longest side, `Back to the landing page`, is about 190 px.

**Middle**, vertically centred in the remaining height:

- the **stage control**: one `<button>` holding the sleeve (S0–S2), the stack (S3–S4f) or the face-up card (S6), at stage size (`visual-identity.md` §7.1: 240 × 336, or 200 × 280 under 360 px wide or 640 px tall). The sleeve takes the stage card's height at its own 5:7.6: 221 × 336, or 184 × 280. The stack beneath the current card shows up to four plain backs offset 3 px down and right.
- S6: the **info block**, 12 px under the card, centred, at most 288 px wide, 4 px between rows:
  1. the tier row (22 px): the tier word (`subhead`, tier text colour) with its stars, then the marker (§7.3) on the same line. The widest, `Legendary`, five stars and `Already yours`, is about 273 px;
  2. the name (`subhead`, `ink-100`, one line, truncated with `title`, `dir="auto"`, 22 px);
  3. the series (`small`, `ink-300`, one line, `dir="auto"`, 20 px).

  That is 72 px, and 75 px with the reduced-motion banner (§4.5).

- the **prompt line**, 16 px under: `small`, `ink-400`, centred.

**Bottom**, `pb-[max(16px,env(safe-area-inset-bottom))]`:

- the **tray**: five slots of 32 × 45 (`radius 4px`, `night-800`, 6 px apart), centred. A turned card's slot shows its art thumbnail in a 2 px frame of its tier's flat colour. Untouched slots stay empty: no tier is shown in the tray before a card is turned. The tray is `aria-hidden`; the counter and the announcements carry it.
- the **controls row**: `Skip` and `Reveal all`, both secondary buttons, each `flex-1` up to 200 px, 44 px tall, 8 px apart, centred. S0 shows neither (§4.1).

Under 600 px of height, the info block's series line is hidden in S6 (the announcement and the summary have it). The block is then 48 px, or 51 px with the banner. At 320 × 568: top bar 56 + card 280 + info block 51 + prompt 36 + tray 45 + controls 44 + paddings 40 = 552 px. At 360 × 640 and 375 × 667 (the 240 × 336 card): 56 + 336 + 75 + 36 + 45 + 44 + 40 = 632 px. So the controls are never below the fold. Nothing scrolls sideways at 320 px.

### 7.3 Markers

- `New` when `isNew` is true: the flat marker of `packs-page.md` §6.2 in the new tokens (1 px `ink-300` border, `ink-100` text, 11 px uppercase).
- `Already yours` when `isNew` is false: same shape, `night-700` border, `ink-300` text. It means the account had this character before this pack, at any tier (`collection-packs.md` §5.3 step 7). It does not mean "duplicate" (§2).
- The demo shows neither: `DemoCard` has no `isNew`.

## 8. The summary (S7)

It is the opening page in its normal layout: the site header, the tab bar on phones, and the page header pattern (`visual-identity.md` §10.1): the eyebrow of the page the pack came from (`Timer packs`, `Themed packs` or `Try a pack`), then the `h1`. `Your pack` is the reveal's `h2` (item 3), never the eyebrow. Top to bottom:

1. **`h1`** (`Pack opening`, `Shop pack`, `Demo pack`), as `packs-page.md` §5.5.
2. **Action row**, as today (`packs-page.md` §3.7 step 2, `market-and-shop.md` §3.3 step 6, `navigation-and-landing.md` §3.14 step 2), plus one link:
   - timer pack: the count line, `Open pack` (primary, same guards and key), `Back to packs` (secondary), `See collection` (text link to `/collection`);
   - shop: `Back to the shop` (secondary), `See collection` (text). There is no buy button here: a Karma spend always starts from `/shop` and its confirmation, which has no "don't ask again";
   - demo: `Open a demo pack` and the disclosure, `Back to the landing page`; after the visit's last pack, the Join offer (§9).
3. **Reveal section** (`packs-page.md` §3.4 items 1–5 and §5.2, unchanged apart from these points):
   - heading `h2` from `packKind` (`Your pack`, `Enchanted pack`, `Radiant pack`; shop `<title> pack`; demo none, the summary says `Demo pack: …`);
   - summary line: `<summary>`, then ` · <k> new` when `k ≥ 1`, then ` · <d> already yours` when `d ≥ 1`, where `d` is the number of cards with `isNew` false. The demo has neither part;
   - the special lines (`card-and-rarity.md` §7.1, §7.2), unchanged;
   - the five cards in slot order at reveal size, every frame effect, with `New` or `Already yours` in the caption row;
   - when `d ≥ 1` and the economy is on `main`, one line under the grid: `Spare copies can be recycled for Karma in your collection.`, with `collection` as a link. It is a fact about a feature, with no number and no urging.

The header's `Packs ready` chip took the answer's allowance when the answer arrived (S0 → S1), and the shop's `Karma` chip took `receipt.balance` at purchase (`market-and-shop.md` §3.1). Both change with `value-tick` (`visual-identity.md` §9.1) and are true from that moment on. The summary adds no number of its own.

## 9. Variants

| Point                      | Timer pack (`/packs/open`)                                        | Shop pack (`/shop/open`)                                                        | Demo (`/demo`)                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| First state                | S0 (the push happens with the request)                            | **S1**: the purchase has answered before the push                               | S0 from `/`, and from `/demo`'s own button                                                                                                 |
| Answer read                | `PackOpened`                                                      | `ShopReceipt.pack`, plus `themeId` for the sleeve                               | `DemoOpened` (no `packKind`, `pityMythic` or `isNew`)                                                                                      |
| Sleeve                     | `sleeve-night`; Enchanted, Radiant and pity marks from the answer | the theme's sleeve and title; the Radiant mark when `packKind` is `radiant`     | `sleeve-night`, `Demo pack · five cards`; never a kind mark (the demo has no kind field, and no comment is made on a demo pack's contents) |
| Pool size for ranks        | held `odds.snapshot`                                              | `ShopResponse.snapshot`                                                         | `GET /api/demo` `odds.snapshot`                                                                                                            |
| Top bar chip               | `Packs ready`                                                     | `Karma`                                                                         | none                                                                                                                                       |
| Markers                    | `New` / `Already yours`                                           | `New` / `Already yours`                                                         | none                                                                                                                                       |
| Frame effects on the cards | yes                                                               | yes                                                                             | yes (owner, 2026-10-31, `visual-identity.md` §16 decision 2; overrides the owner's 2026-10-29 "no glow, glint or drift" on the demo card)  |
| Summary actions            | `Open pack`, `Back to packs`, `See collection`                    | `Back to the shop`, `See collection`                                            | `Open a demo pack` (to the visit's cap), `Back to the landing page`; then Join                                                             |
| Live region on S7          | `<heading>: <summary>.` + ` <k> new.`                             | the purchase line (`market-and-shop.md` §3.3) at the push, then the reveal line | `Demo pack: <summary>.`                                                                                                                    |

**Demo cap.** The visit's last demo pack runs the full ceremony. Its summary shows the Join offer in the button's place, and focus goes to the Join sentence as `navigation-and-landing.md` §3.14 step 7 says. The move happens on entering S7, not when the answer lands, so the ceremony is not interrupted.

## 10. Copy

Exact strings, in `web/src/lib/ceremonyCopy.ts`. The copy test scans them with the rules of `navigation-and-landing.md` §8 and `collection-overview.md` §8: no exclamation marks, no "another", "one more", "win", "lucky", "prize", "jackpot", "free" (outside "free pack(s)"), "worth", "value", "safe", "earn" or urgency words, and no comment on what a pack contained.

| Key                | Element                                                 | Copy                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waiting`          | S0 prompt after 300 ms (`role="status"`)                | `Waiting for the server…`                                                                                                                                                                                                                                                                                              |
| `stillWaiting`     | S0 after 10 s, added under it                           | `Still waiting. Leaving this page is fine: no pack is lost.`                                                                                                                                                                                                                                                           |
| `hold`             | S1 prompt                                               | `Hold to tear it open` (under reduced motion: `Tap to tear it open`)                                                                                                                                                                                                                                                   |
| `keepHolding`      | S1 after a short press, 1.5 s                           | `Keep holding`                                                                                                                                                                                                                                                                                                         |
| `tearName`         | stage control name, S0–S2                               | `Tear open the pack`                                                                                                                                                                                                                                                                                                   |
| `tearHint`         | its description (`aria-describedby`)                    | `Hold, or press Enter.`                                                                                                                                                                                                                                                                                                |
| `floorInside`      | sleeve description, S1 (also announced)                 | `<Floor> or better inside.` (Mythic: `Mythic inside.`), with the kind first when there is one: `Enchanted pack. Epic or better inside.` · `Radiant pack. Mythic inside.` · `Guaranteed Mythic. Mythic inside.` · with no published floor (a shop theme whose odds carry no slots, no socket lit): `Five cards inside.` |
| `burstName`        | stage control name, S3                                  | `Show the first card`                                                                                                                                                                                                                                                                                                  |
| `turn`             | S4 prompt                                               | `Tap to turn`                                                                                                                                                                                                                                                                                                          |
| `turnName`         | stage control name, S4                                  | `Turn card <i> of 5`                                                                                                                                                                                                                                                                                                   |
| `tellText`         | its description, and the S4 announcement                | `Card <i> of 5, face down: <n> of 6 stars lit.`                                                                                                                                                                                                                                                                        |
| `spotlightName`    | stage control name, S5                                  | `Show the card`                                                                                                                                                                                                                                                                                                        |
| `next`             | S6 prompt                                               | `Tap for the next card` · last card: `Tap to see your pack`                                                                                                                                                                                                                                                            |
| `nextName`         | stage control name, S6                                  | `Next card` · last card: `See your pack`                                                                                                                                                                                                                                                                               |
| `counter`          | top bar                                                 | `<i> / 5` (visible, `aria-hidden`); `Card <i> of 5` (visually hidden)                                                                                                                                                                                                                                                  |
| `skip`             | button                                                  | `Skip`                                                                                                                                                                                                                                                                                                                 |
| `revealAll`        | button                                                  | `Reveal all`                                                                                                                                                                                                                                                                                                           |
| `soundOff`         | toggle, off (`aria-pressed="false"`)                    | `Sound` (visible label from `sm`: `Sound off`)                                                                                                                                                                                                                                                                         |
| `soundOn`          | toggle, on (`aria-pressed="true"`)                      | `Sound` (visible label from `sm`: `Sound on`)                                                                                                                                                                                                                                                                          |
| `spotlightEyebrow` | S5                                                      | `Card <i> of 5`                                                                                                                                                                                                                                                                                                        |
| `series`           | S5 eyebrow                                              | `Series`                                                                                                                                                                                                                                                                                                               |
| `popularity`       | S5                                                      | `Popularity #<rank> of <pool>` · without pool `Popularity #<rank>`                                                                                                                                                                                                                                                     |
| `banner`           | S6 under reduced motion, Epic and up                    | `<Tier>` and `Series · <title>`                                                                                                                                                                                                                                                                                        |
| `newMarker`        | marker                                                  | `New`                                                                                                                                                                                                                                                                                                                  |
| `ownedMarker`      | marker                                                  | `Already yours`                                                                                                                                                                                                                                                                                                        |
| `turned`           | S6 announcement                                         | `<name>, <Tier>, <series>.` then ` New.` or ` Already yours.` (demo: neither)                                                                                                                                                                                                                                          |
| `alreadyCount`     | summary line part                                       | ` · <d> already yours`                                                                                                                                                                                                                                                                                                 |
| `recycleHint`      | under the grid, `d ≥ 1`, economy on `main`              | `Spare copies can be recycled for Karma in your collection.`                                                                                                                                                                                                                                                           |
| `seeCollection`    | summary link                                            | `See collection`                                                                                                                                                                                                                                                                                                       |
| (unchanged)        | headings, summary, special lines, actions, live summary | `packs-page.md` §8, `market-and-shop.md` §8, `navigation-and-landing.md` §8                                                                                                                                                                                                                                            |

`<Floor>` and `<Tier>` are `RARITY_LABEL`s; `<n>` is the tier's star count; `<i>` is 1 to 5; `<rank>` and `<pool>` are `Intl.NumberFormat("en-GB")`. Names and series are wrapped in U+2068 … U+2069 in every plain string (§12).

## 11. Sound

**Generated in the browser with the Web Audio API.** There are no audio files, so there is no licence to track, no `media-src` question, and no network request. Everything comes from `OscillatorNode`, `GainNode`, `BiquadFilterNode` and a white-noise `AudioBuffer` filled once by a fixed linear-congruential sequence, so even the noise is deterministic (no `Math.random`, §12).

- **Off by default, every load.** The toggle's state lives in app memory (the signed-in layout for the timer and shop packs, the app-level demo state for `/demo`, as `navigation-and-landing.md` §3.10 holds other page state). It is never in storage (`market-and-shop.md` §3.2 item 4: only the TanStack scroll key). A reload resets it to off.
- **The `AudioContext` is created on the first press of the toggle** (a user gesture), never before. It is closed when the stage unmounts with sound off, and suspended when the tab is hidden (`visibilitychange`). With sound off, no audio object exists.
- Master gain 0.25. No cue is longer than 1.2 s. Cues never overlap more than two at a time; a new tell or turn cue stops the previous one.

| Cue             | When                                         | Recipe                                                                                                                                           |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tear`          | S2 → S3                                      | white noise through a band-pass sweeping 800 → 3,000 Hz over 300 ms, gain envelope 0 → 0.6 → 0                                                   |
| `slide`         | S3, once per card rising (5 × 60 ms)         | triangle 220 Hz, 40 ms, quick decay                                                                                                              |
| `tell-<n>`      | S4 tell in, Uncommon to Mythic (`n` = stars) | sine at `220 × 2^((n−1)·4/12)` Hz (a major-third step per tier), 250 ms, soft attack. **Pitch rises with the true tier.** Common has no tell cue |
| `turn`          | S4f flip                                     | filtered noise click, 30 ms                                                                                                                      |
| `spotlight-<n>` | S5 start, Epic to Mythic                     | a triad on the tell's pitch (root, major third, fifth), 900 ms (Epic), 1.1 s (Legendary), 1.2 s with an added octave (Mythic)                    |
| `summary`       | S7                                           | two sine notes, 523 and 784 Hz, 120 ms each                                                                                                      |

Sound never plays outside the stage: not on `/packs`, not when a pack becomes ready, and not in the background. ADR 0004 §6 and `packs-page.md` §2 ("no notification, sound … about packs") hold.

## 12. Security notes (for the T3 review, C1 and C20)

The ceremony is a presentation of an answer the client already holds. The build PR must show, and the reviewer checks:

1. **Input**: the ceremony takes one held answer (cards, franchises, `packKind`, `pityMythic`, `isNew`) and the held odds. It sends no request. The only network activity during S1–S7 is the art preloads to `s4.anilist.co` (`new Image()` for the five `imageUrl`s at S1, within `img-src`) and the existing collection refetch that the answer already triggered (`packs-page.md` §3.3).
2. **No outcome in the client**: no `Math.random`, no `crypto.getRandomValues`, and no ordering, filtering or tier mapping other than `rarity → stars` (`RARITIES` index + 1). Decorative variation (stack offsets, star positions) comes from the slot number and the character id.
3. **Nothing early in the DOM, beyond what the server sent**:
   - S0–S3 render no character name, series, art `<img>`, tier or `data-*` per card.
   - In S4(i), only card `i`'s tell (its star count and colour) is rendered. Cards after `i` are plain backs with no per-card attribute. Cards before `i` are thumbnails.
   - **Nothing about card `i` beyond its tell is in the DOM before the player turns it.** Its face (name, stars, art `<img>`, rank, series) enters the DOM when the turn starts: at the start of S4f(i), because the flip shows the face in its second half. The info block (tier word, marker) follows at S6(i). On the spotlight path (Epic and up, full motion), S5(i) adds the art, series and rank, and S6(i) adds the name and the rest of the face (§6).
   - S7 renders all five.
   - The answer itself is in memory, in the query and layout state, as today. ADR 0014 accepts that: the rule is "never shown early beyond what the server already sent".
4. **Nothing in storage or the address**: no Web Storage use (only TanStack's scroll key, as today), and no query string, hash or history entry per state. The address stays `/packs/open` (`/shop/open`, `/demo`) from S0 to S7. Back leaves the page, not a ceremony step.
5. **Truthful tells**: the invariants of §3 rule 2, each with a test (§14): sockets = stars of `rarity`; sleeve floor = the published rule for the answer's kind; spotlight iff `rarity ∈ {epic, legendary, mythic}`; the tier word, tint and cue are those of `rarity`; and the time to turnable, the flip and the lock do not depend on the tier.
6. **Bidi and text** (C9, T1): names, native names and series are text nodes, each in its own `dir="auto"` element, and wrapped in U+2068 … U+2069 in every plain string (control names, descriptions, announcements, `title`s). No `dangerouslySetInnerHTML`.
7. **CSP** unchanged: the stage, back, sleeves and tints are CSS gradients and inline SVG elements rendered by React (no `url()` images, no `<style>` injection; custom properties are set through React's `style` prop, which the CSP allows because it uses the CSSOM, as the reveal's `--slot` does today). There is no Web Audio worklet module, so `script-src` is untouched.

## 13. Accessibility

- **Structure**: the stage is the page's `<main>` content. The `h1` is in the top bar. The stage control is one `<button>` whose name and description change by state (§10). `Skip` and `Reveal all` are `<button>`s. The tray, stack, tint, sleeve drawing and tell drawing are `aria-hidden`; their meaning is in the control's name and description and in the announcements.
- **Focus**: arriving on the page puts focus on the `h1` (`navigation-and-landing.md` §3.6), and the stage control is the next Tab stop after the top bar's links and toggle. Focus stays on the stage control from S1 to S6, because it is the same element throughout. When S7 replaces the stage and focus was inside it, focus moves to the reveal's `h2` (`tabindex="-1"`). From S7, `Open pack` returns focus to the stage control when the new stage reaches S1, so a keyboard player can open and turn without reaching for the mouse.
- **Keyboard path** (S1 to S7, keyboard only): Tab to the stage control → Enter (tear) → Enter (first card) → Enter (turn) → Enter (next) → … → S7. `Skip` and `Reveal all` are the next two Tab stops after the control, and Escape is `Reveal all` from anywhere in S1–S6. No step needs a pointer, a hold or a swipe.
- **Announcements** go to the app's single polite live region (`accounts.md` §7). One message per player action, never more:
  - S1: `floorInside` (for example `Radiant pack. Mythic inside.`);
  - S4(i): `tellText` (`Card 2 of 5, face down: 4 of 6 stars lit.`), the same information the colour and sockets give a sighted player;
  - S6(i): `turned` (`Gojo Satoru, Epic, Jujutsu Kaisen. New.`), so **each card is announced once, when turned**;
  - S7: the reveal line (`packs-page.md` §7), once.
  - `Reveal all` announces only the S7 line, and the five cards are then in the list in reading order. S5 adds no message of its own (S6's follows).
- **Screen-reader clicks**: a `click` with `detail` 0 tears at once (§4.3), so assistive tech that synthesises clicks never meets the hold.
- **Reduced motion**: §4.5. With it, `getAnimations()` on the stage is empty in every state.
- **Contrast**: every text pair on the stage is in `visual-identity.md` §5.4. The prompt line is `ink-400` on the stage background's darkest-to-lightest range (`#07080f`–`#151830`): 7.74 down to 6.75. On the S4–S6 tint (14–18 % at its centre), `ink-400` stays at 5.88 or more and the tier text at 5.16 or more (Epic text on `#25111b`). On the spotlight's stronger tint, §6 lists the pairs and the `ink-300` rule.
- **Touch targets**: every control is 44 px or more, and the stage control is the card itself.
- **Timing (WCAG 2.2.1)**: nothing waits on a timer that the player must beat. The spotlight's auto-advance is skippable and leads to a state that waits, and the reduced path has no timer at all.
- **Flashing (WCAG 2.3.1)**: no element changes luminance more than 3 times a second. `tell-breathe` is one cycle per 1.6 s, and the tint fades over 250 ms.

## 14. Test plan

### 14.1 Unit (Vitest)

`ceremonyReducer` (pure):

1. Every cell of the §4.2 table: each event in each state gives the listed next state, and `·` cells give the same state object.
2. `REVEAL_ALL` from every state S1–S6, for i = 0..4, gives S7. `SKIP` from every state gives the listed state.
3. Reduced motion: S1 `PRESS` → S4(0) with no S3; `ADVANCE` in S4 never yields S5 for any tier; S4f yields S6 at once.
4. **Truthful tells**, for each of the six tiers: `tellFor(rarity).sockets === RARITIES.indexOf(rarity) + 1`, the rim token is that tier's flat colour, and the glow is `none`, `tell-rare` or `glow-<tier>`. The spotlight is reachable iff the tier is Epic, Legendary or Mythic. The spotlight's tier word equals the card's `RARITY_LABEL`.
5. **Never more, never a climb**: render S4 for each tier and assert the lit count is exactly the stars at every animation frame (the tell has no intermediate frame with a different count).
6. **Same tempo**: for packs of six single-tier fixtures, the elapsed time from entering S4(i) to the first moment `ADVANCE` is accepted is identical (tell-in + lock), and the flip duration is identical for Common, Uncommon and Rare.
7. **Sleeve floor**: `sleeveFloor(odds, packKind, pityMythic)` gives Rare for standard, Epic for Enchanted, Mythic for Radiant and for `pityMythic`, and for a shop theme with no slots, none, whose `floorInside` is `Five cards inside.`. Going from S0 to S1 never lowers the lit count.
8. **Timings agree**: the values in `ceremonyTimings.ts` equal the `--stage-*` custom properties parsed from `index.css`.

Components (Testing Library):

9. In S0–S3 the DOM holds none of the five names, series or art URLs as `<img>`, and no element has a per-card tier attribute. In S4(2), cards 3 and 4 are plain backs, only card 2's tell is present, cards 0 and 1 are thumbnails, and card 2's name and art are absent. Card 2's face is present from the start of S4f(2).
10. Announcements: a full keyboard run produces exactly: 1 S1 message, 5 tell messages, 5 turned messages and 1 summary message, in that order. A run with `Reveal all` from S4(1) produces the S1 message, 2 tell messages, 1 turned message and the summary, then nothing more.
11. Guards: a click with `detail: 2` and a keydown with `repeat: true` change nothing. Two `ADVANCE`s within 150 ms move one step. A pointer held 900 ms on the stage control and then released, with its `click`, ends in S3, not S4(0).
12. Escape in S3 gives S7, and Escape in S7 does nothing.
13. Focus moves to the reveal `h2` when S7 replaces the stage with focus inside it.
14. Sound: with a stubbed `AudioContext` constructor, a full run with sound off constructs none. Pressing the toggle constructs exactly one, on that press. Remounting the layout starts off.
15. Bidi: hostile names (RTL override, `<script>`, a 300-character name) render as text in S5, S6 and the announcements, wrapped in U+2068 … U+2069.
16. Copy scan of `ceremonyCopy.ts`.

### 14.2 End to end (Playwright, against the compose stack; crafted answers with `route.fulfill`)

1. **Keyboard only**: sign in, `/packs`, Tab to `Open pack`, Enter → `/packs/open`. Tab to the stage control, then Enter repeatedly through S1 to S7. The live region log matches §13. Focus ends on the reveal `h2`.
2. **Truthful tell, crafted**: `POST /api/packs/open` is fulfilled with rarities Common, Uncommon, Rare, Epic, Mythic in slots 0–4. At each S4(i) the stage control's description reads `<n> of 6 stars lit` with n = 1, 2, 3, 4, 6, and exactly that many sockets are lit (counted by a test hook `data-lit` on each socket, present only on the current card). A spotlight shows on slots 3 and 4 only, with the words `Epic` and `Mythic`. Each turned card's article label has the same tier.
3. **Truthful tell, real**: on the seeded stack, open 20 packs with `page.route` passing through and recording each response. For every card, the lit count at its S4 equals its `rarity`'s stars, and a spotlight showed iff Epic or rarer.
4. **Sleeves**: answers with `packKind` `enchanted`, `radiant`, and `standard` with `pityMythic`, each give the kind mark and 4, 6 and 6 lit sockets. A standard answer gives 3. A delayed answer shows 3 during S0.
5. **Slow answer**: the answer is delayed 3 s. `Waiting for the server…` appears after 300 ms, the stage control is `aria-disabled`, and `Skip` and `Reveal all` are absent. Holding does nothing. Then S1.
6. **No answer**: the request is aborted. The page ends on `/packs` with `Try again` (`packs-page.md` §10 e2e 6); no stage remains.
7. **Get out anywhere**: `Reveal all` from S1, S3, S4(2), S5 (an Epic in slot 2) and S6(3), and Escape from S2, each end on S7 with the five cards in slot order.
8. **Reduced motion** (`page.emulateMedia({ reducedMotion: "reduce" })`): one click tears; no spotlight layer is ever attached; Epic and up show the banner; `document.getAnimations()` filtered to the stage is empty in every state.
9. **Hold**: a pointer down for 300 ms then up leaves S1 and shows `Keep holding`. A pointer down for 800 ms reaches S3, and its release does not skip the burst. A `pointercancel` mid-hold unwinds.
10. **Swipe and tap** under touch emulation: a 60 px swipe left advances, and so does a tap.
11. **Sound**: an `AudioContext` constructor spy (`addInitScript`) counts 0 across a full ceremony. Toggling sound on counts 1. After a reload, the toggle reads off.
12. **Storage and address**: after a ceremony, Web Storage holds only TanStack's scroll key. `page.url()` is `/packs/open` at every state, and `history.length` grows only by the push from `/packs`.
13. **DOM leak**: at S1, `page.content()` contains none of the five character names. At S4(3), it contains the names of slots 0–2 only.
14. **No requests during the ceremony**: from S1 to S7, requests to `/api/*` are exactly the collection refetch the answer triggered. There is no other API call.
15. **Leave and return**: Back during S4(2) goes to `/packs`. Forward shows S7 with no running animations and no stage.
16. **Shop**: buy a theme. `/shop/open` starts at S1 with the theme's sleeve and title. The top bar's Karma chip shows `receipt.balance`. The summary has `Back to the shop` and no buy button.
17. **Demo**: `/` → `Open a demo pack` → `/demo` S0 → … → S7 with no markers. A crafted Epic in the demo pack shows its frame glow and glint in S6 and in the summary. Ten packs end with the Join offer, focused after S7 of the tenth.
18. **Layout**: at 320 × 568, 375 × 667 and 1280 × 800, every state has no horizontal scroll, and `Reveal all` is fully in the viewport.
19. **Contrast smoke**: axe-core on S1, S4, S6 and S7 reports no contrast violations.

## 15. Changes to other specs

**Amended in this PR (pointers to ADR 0014 and this spec):** `collection-packs.md` §8, `card-and-rarity.md` §5.3, §7 and §7.1, `packs-page.md` §3.4 step 6, and `navigation-and-landing.md` §12 (two rows).

**Superseded when PR 5 or PR 7 lands** (`visual-identity.md` §15). The build PR edits these passages:

| Passage                                                                                                                                                                                                              | Becomes                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packs-page.md` §3.7 steps 2–4 and §5.5 (the opening page's layout and in-flight state)                                                                                                                              | the stage (§7) from S0 to S6, then the summary (§8) with the same action row                        |
| `packs-page.md` §4.2 rows "arriving from `/packs`, in flight" and "revealed …"                                                                                                                                       | S0 and S1–S7                                                                                        |
| `packs-page.md` §6.3 "The reveal entrance is the only new motion" and §7 "Reduced motion: no entrance …"                                                                                                             | §4.4, §4.5                                                                                          |
| `packs-page.md` §10 e2e 15 (reduced motion) and 7 (the reveal)                                                                                                                                                       | §14.2 items 1, 2, 8                                                                                 |
| `market-and-shop.md` §3.3 step 6 "with the entrance"                                                                                                                                                                 | starts at S1 (§9)                                                                                   |
| `navigation-and-landing.md` §3.7 item 1.4 ("the 1c reveal card … no glow"), §6.2 "Motion" and "Nothing else … sound, 'rare pull' emphasis, or a different treatment for a Legendary or Mythic in the demo"           | §9 demo column (effects on, `visual-identity.md` §16 decision 2)                                    |
| `card-and-rarity.md` §12 note "the landing demo card" (2026-10-29: no glow, glint or drift; §5.3 and §9 leave out the demo pack), and the matching bullet of the owner exception in `06-engineering-standards.md` §2 | §9 demo column: effects on `/demo` (owner, 2026-10-31); the landing's showcase fan still plays none |

## 16. Decisions

None of its own. Two of the owner's decisions in `visual-identity.md` §16 (2026-10-31) shape the ceremony:

- **Decision 2** (the owner's own words): on `/demo` the ceremony runs in full and the cards show every frame effect (§9). It overrides the owner's 2026-10-29 "no glow, glint or drift" on the demo card.
- **Decision 3** (the manager's reading; the owner may revise): the stage's top bar shows `Packs ready` for a timer pack and `Karma` for a shop pack (§7).

**Taken from the mockup into this spec** (2026-10-31, its "not in spec" list): the click that ends a hold is ignored (§4.3); the empty tray in S0 and the 60 ms stagger of the burst (§4.1); the stage's star layer at 40 % at rest (§5); the spotlight's 150 ms fade-in and tap anywhere to advance (§6, §4.3); the sleeve at the stage card's height (§7). The back link's ellipsis is not taken: below 640 px the link is an icon (§7). The burst's distances and the spotlight's spacing stay as drawn in the mockup, as a reference and not a rule. The summary grid stays as `packs-page.md` §5.2 has it.
