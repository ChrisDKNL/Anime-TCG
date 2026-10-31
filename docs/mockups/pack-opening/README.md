# Prototype: pack opening

- **Artifact (private):** https://claude.ai/artifact/Qg7szqQYhsKyXcwQYtJTp7
- **Spec:** `docs/design/pack-opening.md`, `docs/adr/0014-slot-style-pack-opening.md`, and `visual-identity.md` §7, §8, §12 and §16 question 2 (PR #64).
- **Made:** 2026-10-31 by `mockup-artist`. Throwaway HTML; nothing in `web/` depends on it. The `today/` images are published from `../redesign-pages/today/`.

## What it does

- **The state machine:** S0 to S7 run as a pure reducer that follows the §4.2 table. Each state is clickable:
  - Hold to tear: 700 ms with the Volt tear line; release early to see `Keep holding`.
  - Enter, Space, a click with `detail` 0, → and a 48 px swipe, as §4.3 lists them.
  - `Skip`, `Reveal all` and Escape.
  - The 150 ms input lock.
  - S0's waiting lines, when the server answer is set to 12 s.
- **Tells and spotlights:** the sockets, rim, glow and breathe of §7.2, the stage tint and brighter stars of §5, and the spotlights for Epic, Legendary and Mythic (1.4, 2.0 and 2.6 s).
- **Reduced motion:** a toggle. One tap tears; there is no burst, flip or spotlight; Epic and up get the static banner; glint and drift are off.
- **Sound:** off on every load. The `AudioContext` is created on the first press of the toggle. The cues follow §11's recipes, with a fixed LCG for the noise.
- **Routes:** timer pack (`/packs/open`, the `Packs ready` chip, markers), shop pack (`/shop/open`, starts at S1 with a theme sleeve and the Karma chip) and demo (`/demo`, no markers, no kind mark).
- **Packs:** a showcase script with one card of each tier from Uncommon to Mythic. It is labelled as not a real pack, because a standard pack has only one card of Rare or better. The other packs are dealable: a typical standard pack, one with an Epic in card 5, Enchanted, Radiant and Guaranteed Mythic.
- **Side panel:** the current state, the live-region messages (§13) and the events. Its Jump buttons are for review only.
- **Frames:** 390 × 844 (the default), 320 × 568 and 1440 × 900.

## Variants: Q2, effects on the demo's cards

| Variant | Trade-off |
| --- | --- |
| **A** Full ceremony with frame effects on demo cards (spec, recommended) | The demo shows exactly what the game shows. It overrides the owner's 2026-10-29 "no glow, glint or drift" on the demo card. |
| **B** Ceremony with plain demo cards | Keeps the 2026-10-29 decision. The tell and the spotlight still play, but the turned card has no glow, glint or drift, so Epic and up look flatter. |

`Compare Q2 A / B` shows S6 (a Legendary face up) and the S7 summary side by side. The pick is stored as `picks/demo-effects` in the artifact's database, with a chat line as the fallback.

## Not in spec

- The sleeve on the stage is sized to the stage card's height (221 × 336, or 184 × 280 when small). The spec's "at stage size" is for a 5:7 card, and the sleeve is 5:7.6.
- The colour of a sleeve's lit sockets (the floor tier's mark colour), and the Radiant sleeve's ring and unlit sockets.
- The details of the burst: how far the seam lifts and the sleeve drops, and the cards rising 60 ms apart.
- The spotlight's vertical layout, its 150 ms fade-in, and tapping anywhere on it to advance.
- The stage's star layer: 48 × 67 px tiles at 40 % opacity at rest.
- The empty tray shown in S0.
- The click that ends a hold is ignored. Without that, holding past 700 ms and then releasing sends `ADVANCE` in S3 and skips the burst. The spec should say so.
- The back link's label is cut with an ellipsis when it does not fit (see contradiction 2).
- The summary grid: `auto-fill`, at least 136 px per card, two across at 320 and 390.

## Spec contradictions and gaps (for `ui-designer`)

1. **The DOM rule vs the flip.** §12.3 says a card's name and art enter the DOM at S6 (art at S5). §4.1 has the face show during the S4f flip, so it must be in the DOM in S4f.
2. **The top bar at 390 px (§7).** The back link, the centred `h1`, the source chip and the 44 px sound toggle do not fit: `Back to the landing page` collides with `Demo pack`, and `Back to packs` must truncate. The text is hidden only below 360 px. Suggestion: hide the text below 640 px, or drop the centring.
3. **The card back's rim (visual-identity §7.2).** It says "5 px, the same thickness as a front frame", but the front frame at stage size is 6 px (§7.1). The prototype uses 5 px at reveal size and 6 px at stage size.
4. **The summary's eyebrow (§8).** §8 gives `Your pack`, but `visual-identity.md` §10.1 places the opening pages' eyebrow in the stage's top bar. `Your pack` also repeats the reveal's `h2`.
5. **A shop pack with no lit sockets.** When the theme's odds carry no slots (§8.1), the sleeve lights nothing, and `floorInside` has no copy for that case. The S1 announcement is undefined.
6. **The S6 info block (§7).** It is budgeted at 64 px, but the tier line, name, series and marker take about 90 px. It fits at 320 × 568 only because the series line is hidden under 600 px of height.
