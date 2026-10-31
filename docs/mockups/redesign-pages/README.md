# Mockup: redesign pages

- **Artifact (private):** https://claude.ai/artifact/MGFEYGyE3ZsWqiQ4MrS1eH
- **Spec:** `docs/design/visual-identity.md` (PR #64), §4–§12 and §16 questions 1 and 3.
- **Made:** 2026-10-31 by `mockup-artist`. Throwaway HTML; nothing in `web/` depends on it.

## What it shows

The landing page (`/`), `/packs`, and the header and phone tab bar, each at 1440 × 900, 390 × 844 and 320 × 568. Frames use CSS container queries in place of the app's `sm` (640) and `lg` (1024) media queries.

- **Today:** screenshots in `today/`, taken from the acceptance stack at `http://127.0.0.1:8180`, signed out, on 2026-10-31: `/` and `/demo` at each width. Card art had not loaded when they were taken, so no AniList image is in them.
- **`/packs` states:** loading, 2 of 3 ready, 3 of 3, 0 of 3, and the load failure. `Pack odds` opens the dialog with the new bar column.
- **Header and tab bar:** the tabs and header links switch the page, which shows each page's eyebrow and title (§10.1).

## Variants

| Question | Variant | Trade-off |
| --- | --- | --- |
| Q1 landing art (§16.1) | **A** Showcase fan behind the sleeve (spec) | Art before the first word, with real tiers and frames. Needs the server's `showcase` (PR 6a, T2) and a taller phone hero. |
| | **B** No art, the sleeve alone | No server change and a shorter hero. Nothing but drawn objects until the visitor opens a demo pack. |
| Q3 header (§16.3) | **A** `Packs ready` and `Karma` chips, plus the count on the centre tab (spec) | Progress on every page, with no motion or colour change. It relaxes `packs-page.md` §2's "no badge". |
| | **B** No chips: Karma as plain text, no pack count (the spec's option **C**) | The quietest header. It reads less like a game. |

The spec's Q3 option B (a pity chip) is not mocked; the brief asked for "no chips" as the alternative.

The owner records a pick on the page. It goes to the artifact's shared database as `picks/landing-art` and `picks/header-chips` (`{choice, note, at}`). If the database is not available, the page shows a line to send in chat.

## Not in spec (dashed pink in the mockup)

- The desktop header's page links: `ink-400`, and the current page in `ink-100` with a 2 px Volt underline. §13 drops today's tab group, but §10.2 gives no replacement.
- The Account control's restyle: `night-850`, `radius-control`, avatar only at 44 px on a phone.
- The colour of a sleeve's lit sockets: the mockup uses the floor tier's mark colour. On the Radiant sleeve, the ring and unlit sockets are also unspecified.
- The fan's offsets and which tier gets which rotation (Legendary −9°, Epic −3°, Rare +5°, left to right).
- The hero's star tile (190 × 170 px) and the horizon ring's top edge at 68 % of the hero's height.
- The odds bar column's place (between Tier and the figure) and the bar's height (6 px).
- The tier band's card width on a phone (92 px).
- The sleeve on `/packs` in the loading and failed states (shown unchanged).

## Spec contradictions and gaps (for `ui-designer`)

1. **§11.2, the phone art column.** It says the column is 168 px tall, but cards 110 px wide with a 96 px sleeve covering their lower third need about 250 px. Rendered at 250 px, `Open a demo pack` ends at 550 of 568 px at 320 × 568. The button stays above the fold, but the disclosure goes below it. B's sleeve alone (146 px) fits in 168 px.
2. **§11.2: "the sleeve to 96 px".** It does not say whether 96 px is the width or the height. The mockup reads it as the width.
3. **§4.1 fonts.** `@fontsource-variable/bricolage-grotesque/wdth.css` has no `opsz` axis, so the display face keeps its default optical size even at 96 px. Google Fonts serves `opsz`, so the mockup sets `font-optical-sizing: none` to match the npm build. Should the spec use `full.css` instead?
4. **§10.2 vs §13.** §13 supersedes the look of the tab group, but no section defines how desktop page links look now.
