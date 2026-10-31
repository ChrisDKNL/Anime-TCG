# Visual identity

Cross-cutting (the manager adds the roadmap row) · the replacement visual system that `docs/06-engineering-standards.md` §2 and the agent brief call `visual-system.md`, and that `packs-page.md` §2, `navigation-and-landing.md` §2 and §6.1 defer to · the pack-opening ceremony is its sibling, `pack-opening.md` · owner decision [ADR 0014](../adr/0014-slot-style-pack-opening.md) (slot-style opening, 2026-10-31) · written 2026-10-31 · owner decisions of §16 recorded 2026-10-31 · mockups (private claude.ai artifacts, `docs/mockups/`): [redesign pages](https://claude.ai/artifact/MGFEYGyE3ZsWqiQ4MrS1eH), [pack opening](https://claude.ai/artifact/Qg7szqQYhsKyXcwQYtJTp7) · this PR is specs only; tokens and components come in the build PRs of §15

> **Owner request, 2026-10-31.** The site reads like a tidy docs page, not a game. The owner pointed at kyara.games for the feel. **We take its principles, not its identity.** The ones taken: art up front, a three-role type system, a colour story (one dark ground, one action colour, one reward colour, rarity colours everywhere), every page themed with a label and a big title, packs drawn as objects, persistent progress in the header, motion that celebrates, a phone tab bar with the pack in the middle, and copy with a voice. Left out: its kanji seals and emblems, its display face (Unbounded), its monospace (JetBrains Mono), its orange-and-yellow scheme, its warm brown-black, its wave-pattern card back, its wording ("Hold the seal to break it"), and its social feeds, streaks, missions and "don't warn me again". §14 is the full list.

## 1. Goal

Make Anime TCG look and feel like a card game. A visitor sees character art before they read a word. Every page has the same voice: a small mono label, a big heavy title, numbers in mono, rarity colours that mean the same thing everywhere. Packs are drawn as objects you tear open. The header always shows what you have: packs ready and Karma. On a phone, the main pages sit in a bottom tab bar with Packs in the middle. The identity has its own motif, **the Orbit**: a ring with six star sockets, one for each tier. It is on the card back, on every pack sleeve and in the opening ceremony. The number of lit sockets always tells the truth about a tier.

This spec gives the tokens (§12) the engineer turns into `web/src/index.css`, and the rules each build PR follows. It changes no flow, route, server contract or copy rule except where §13 says so.

## 2. Out of scope

- **The opening ceremony's flow, states and timings.** They are in `pack-opening.md`. This spec gives only its pieces: the card back (§7), the sleeves (§8) and the tokens.
- **The card face and frames.** The owner chose them (`card-and-rarity.md` §4, §5). The only changes here are the type families on the card (§6.3) and the stage size (§6.2).
- **Live and social sections** (feeds of other players' pulls, top collectors, reviews, streaks, missions, referrals). `navigation-and-landing.md` §3.7 "never shows" stands. Each one is a nudge.
- **A light theme.** Dark only, as today.
- **New routes, server fields or copy rules.** The one server ask is the landing showcase (§11.2, chosen in §16 decision 1, built in PR 6a). The landing still works without it.
- **Profile (item 4) and the mini-games (items 5, 6).** They will use this system in their own specs. ADR 0014 says the blackjack and slots specs may reuse the ceremony rules.

## 3. Principles

1. **Art first.** Any page that can show character art shows it before text that describes it. Empty grey boxes are a bug, not a state. Wherever we have no art yet, we show the drawn object instead: a sleeve or a card back.
2. **Three voices of type.** Display for things you feel (titles, tier words). Sans for things you read. Mono for things you count (numbers, labels, ranks).
3. **One ground, one action, one reward, six tiers.** Night (a cool blue-black, the colour of the card face) is the ground. **Volt** is the action colour, the only fill on a primary button and the focus ring. **Ion** is the reward colour, used for Karma. The six tier colours are the owner's and mean the tier wherever they appear. No other hue carries meaning.
4. **Every page is a scene.** A mono eyebrow, then a display title. Sections are separated by space and a hairline, not by boxes.
5. **Motion explains or celebrates, and never lies.** Outside the opening ceremony, motion stays within the standards (150–250 ms, no loops apart from the owner's card frames). Inside the ceremony, ADR 0014 allows more, and `pack-opening.md` bounds it.
6. **The Orbit tells the truth.** Lit sockets mean tiers: one for Common up to six for Mythic. A sleeve lights the sockets of the floor its rules guarantee. A card back lights the sockets of its real tier. Nothing ever lights more sockets than are true (ADR 0014 §2).

## 4. Type system

### 4.1 Families

All three are under the SIL Open Font License 1.1 and self-hosted from npm packages. Vite bundles them into `/assets`, so they are served from our own origin. The CSP already has `font-src 'self'` (Caddyfile, CI `EXPECTED_CSP`, `web/e2e/stack.spec.ts`), so the CSP does not change. There is no Google Fonts or other third-party host.

| Role        | Family                                                              | Package (version checked 2026-10-31)             | File imported                                       | Axes used                                       | Latin woff2 | Licence                                                 |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------- | ----------- | ------------------------------------------------------- |
| **Display** | Bricolage Grotesque (Atelier Triay), `Bricolage Grotesque Variable` | `@fontsource-variable/bricolage-grotesque` 5.3.0 | `@fontsource-variable/bricolage-grotesque/wdth.css` | weight 200–800, width (`font-stretch`) 75–100 % | 78 KB       | OFL-1.1, © 2022 The Bricolage Grotesque Project Authors |
| **Sans**    | Figtree (Erik Kennedy), `Figtree Variable`                          | `@fontsource-variable/figtree` 5.3.0             | `@fontsource-variable/figtree/wght.css`             | weight 300–900                                  | 20 KB       | OFL-1.1, © 2022 The Figtree Project Authors             |
| **Mono**    | Martian Mono (Evil Martians), `Martian Mono Variable`               | `@fontsource-variable/martian-mono` 5.3.0        | `@fontsource-variable/martian-mono/wght.css`        | weight 100–800                                  | 24 KB       | OFL-1.1, © 2020 The Martian Mono Project Authors        |

- **Why these.** Bricolage at weight 800 and 75–85 % width is a heavy, slightly quirky grotesque with ink traps. It is narrow, so the big tier words fit a 320 px screen. Kyara's display face is wide and round; ours is the opposite. Figtree is clear at 11–13 px, which the card needs. Martian Mono has a squarish, technical look for counts and labels, and it is not JetBrains Mono.
- **Optical size.** The build imports `@fontsource-variable/bricolage-grotesque/wdth.css`, nothing else from that package. Version 5.3.0 has no `full.css`. Its all-axis file is `standard.css` (`opsz` 12–96, `wdth`, `wght`), and that file's latin woff2 is 132 KB against 78 KB for `wdth.css`. `wdth.css` has no `opsz` axis, so the display face always draws at its default optical size, 14, at every size from the 13 px wordmark to the 96 px hero. That is the look the owner chose from: the mockups set `font-optical-sizing: none` to match it. The build sets no `font-optical-sizing` and no `font-variation-settings: "opsz"`, because they do nothing without the axis. A switch to `standard.css` would change the shapes at display sizes, so it needs a new mockup and the owner's agreement.
- **Loading.** The three CSS files are imported once, in `web/src/main.tsx` before `index.css`. Each `@font-face` from fontsource has `font-display: swap` and a `unicode-range`, so the latin-ext and Vietnamese files load only when a string needs them. The latin set is about 122 KB in total. There is no `<link rel="preload">`: the hashed file names are not known in `index.html`, and swap is acceptable.
- **Fallbacks.** Each stack ends with the system stack (§12.2). Japanese and other non-Latin names (`nameNative`, `titleNative`) fall through to the system's CJK fonts, as today. `✦` (U+2726) is outside the latin `unicode-range` and keeps coming from the system font, so the stars look the same as now.
- **Dependency review (C13).** These are three new runtime dependencies. They ship only CSS and woff2 files: no JavaScript and no install scripts. The PR that adds them (§15, PR 1) is T2 and needs a `security-officer` review. Each package ships its OFL `LICENSE`. Each package's `LICENSE` file is copied into the build as `/licenses/fonts.txt` and linked from the footer's attribution line (§11.1). This meets OFL §2's licence-with-redistribution clause.
- **The alternative, if review prefers no npm dependency:** vendor the same three woff2 files and their `LICENSE` into `web/src/assets/fonts/`, with a hand-written `@font-face` block. The result in the browser is the same. Recommendation: the packages, because Dependabot then keeps them current (C13).

### 4.2 Scale

Sizes are px at phone / `sm` / `lg`. Display sizes use Bricolage at weight 800 and width 85 % (`font-stretch: 85%`). The tier word uses width 75 %.

| Token       | Use                                           | Family  | Size                            | Line height | Tracking | Weight / width        |
| ----------- | --------------------------------------------- | ------- | ------------------------------- | ----------- | -------- | --------------------- |
| `hero`      | landing `h1`                                  | display | 48 / 72 / 96                    | 0.9         | −0.02em  | 800 / 85 %            |
| `title`     | every other page's `h1`                       | display | 36 / 48 / 56                    | 0.95        | −0.015em | 800 / 85 %            |
| `section`   | `h2`                                          | display | 24 / 28 / 28                    | 1.05        | −0.01em  | 750 / 90 %            |
| `tier-word` | the full-screen tier word (`pack-opening.md`) | display | `clamp(3.5rem, 18vw, 10rem)`    | 0.85        | 0.01em   | 800 / 75 %, uppercase |
| `subhead`   | `h3`, card name in the ceremony               | sans    | 17                              | 1.3         | 0        | 700                   |
| `body`      | text                                          | sans    | 16                              | 1.5         | 0        | 400                   |
| `small`     | secondary lines                               | sans    | 14                              | 1.45        | 0        | 400 / 500             |
| `xs`        | captions                                      | sans    | 12                              | 1.4         | 0        | 500                   |
| `eyebrow`   | page label, section label                     | mono    | 11 / 12 / 12                    | 1.2         | 0.12em   | 500, uppercase        |
| `num`       | counts, prices, percentages, ranks, chips     | mono    | 13 (inherits size where inline) | 1.2         | 0        | 500, `tabular-nums`   |

- The landing `hero` at 48 px and width 85 % sets `Anime TCG` in about 230 px, which fits 288 px of content at 320 px.
- Uppercase is set with CSS (`uppercase`). The source strings stay in sentence case, so copy tests read them normally.
- Numbers in running text stay in the sans with `tabular-nums`. The mono `num` style is for numbers that stand alone: chips, counters, odds figures, the rank chip, prices.

## 5. Palette

### 5.1 Night (ground) and ink (text)

The ground is a cool blue-black. It continues the card face's own night sky (`#1b1e36` → `#121320`), so cards sit in their world instead of on grey. Kyara's ground is a warm brown-black (`rgb(14 13 18)`), ours is clearly blue.

| Token       | Hex       | Use                                                                   |
| ----------- | --------- | --------------------------------------------------------------------- |
| `night-950` | `#07080f` | page background                                                       |
| `night-900` | `#0e1020` | header, bottom bar, panels, dialogs                                   |
| `night-850` | `#151830` | raised: chips, sheets, inputs, sleeve sheet on `/packs`               |
| `night-800` | `#1d2140` | hover and pressed fills, skeletons, empty slots                       |
| `night-700` | `#2a2f55` | hairlines (`line`), card-back socket off                              |
| `night-600` | `#3a4070` | strong hairline (`line-strong`), input border, card-back rim          |
| `ink-100`   | `#eef0fa` | primary text                                                          |
| `ink-200`   | `#dde0ee` | emphasised secondary text, numbers in lines                           |
| `ink-300`   | `#c3c7dc` | secondary text                                                        |
| `ink-400`   | `#9aa0bd` | tertiary text, labels, eyebrows                                       |
| `ink-500`   | `#6e7493` | non-text only: disabled text, decorative numbers, icons beside a word |

### 5.2 Action, reward and status

| Token        | Hex       | Name | Use                                                                                                       |
| ------------ | --------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `volt`       | `#c8f031` | Volt | the one action colour: primary button fill, focus ring, current tab marker, the hold progress on a sleeve |
| `volt-hover` | `#d9f86a` | —    | primary button hover                                                                                      |
| `volt-press` | `#b3d924` | —    | primary button pressed                                                                                    |
| `volt-ink`   | `#07080f` | —    | text on Volt                                                                                              |
| `ion`        | `#5cd6f5` | Ion  | the reward colour: Karma amounts and the Karma chip's number. Never on a button, never for a tier         |
| `danger`     | `#ff9b8f` | —    | error text (replaces `red-300`); always words, always with `role="alert"` or the banner                   |

- **Why Volt.** The tier colours take grey, teal, blue, ruby, amber and lavender. The clearest free hue on the wheel is yellow-green (hue 75°, 40° from Legendary's amber and 90° from Uncommon's teal). Volt reads as "press here" on night and never as a tier. It is not violet, so the old violet/fuchsia debt goes with it.
- **Why Ion.** The reward colour is a light cyan (hue 193°). It sits between Uncommon (167°) and Rare (222°), but it is much lighter than either. It always comes with the word `Karma`, and tiers always come with their stars or tier word, so the two are never told apart by colour alone. The owner's "no icon for Karma" (`market-and-shop.md` §6) stands: Ion is a colour, not an icon.
- **Gradients.** Volt and Ion are always flat. Gradients appear only on drawn objects and the stage: the owner's card frames, the card face and back, the sleeve's sheen (§8) and the stage and hero backgrounds (§12.5). There are no gradient buttons or gradient text (standards §2).

### 5.3 Tier colours

The tier colours do not change (`card-and-rarity.md` §4.2, §5.2, §10). They now appear in more places, always with a star count or the tier word:

- tier words and stars (as today);
- odds bars (§11.2, the odds dialog);
- the card back's lit sockets and rim in the ceremony (§7);
- the stage tint and the full-screen tier word for Epic and up (`pack-opening.md`).

### 5.4 Contrast (WCAG 2.x, computed with the relative-luminance formula)

Text needs 4.5:1; large display text (24 px+, or 18.66 px+ bold) and non-text marks need 3:1.

| Foreground                     | on `night-950` | on `night-900` | on `night-850` | on `night-800` |
| ------------------------------ | -------------- | -------------- | -------------- | -------------- |
| `ink-100` `#eef0fa`            | 17.59          | 16.59          | 15.33          | 13.75          |
| `ink-200` `#dde0ee`            | 15.20          | —              | 13.25          | —              |
| `ink-300` `#c3c7dc`            | 11.92          | 11.25          | 10.39          | 9.32           |
| `ink-400` `#9aa0bd`            | 7.74           | 7.31           | 6.75           | 6.06           |
| `ink-500` `#6e7493` (non-text) | 4.36           | 4.11           | 3.80           | 3.41           |
| `volt` `#c8f031` (text, ring)  | 15.19          | 14.34          | 13.25          | 11.88          |
| `ion` `#5cd6f5`                | 11.79          | 11.13          | 10.28          | 9.22           |
| `danger` `#ff9b8f`             | 9.84           | 9.28           | 8.58           | 7.69           |
| Common `#9a9da6`               | 7.37           | 6.96           | 6.43           | 5.77           |
| Uncommon `#3cc7a9`             | 9.46           | 8.92           | 8.24           | 7.39           |
| Rare `#6f95ec`                 | 6.84           | 6.45           | 5.96           | 5.35           |
| Epic text `#e45b76`            | 5.76           | 5.44           | 5.03           | **4.51**       |
| Legendary `#f5b84a`            | 11.27          | 10.63          | 9.82           | 8.81           |
| Mythic `#b79ff0`               | 8.79           | 8.29           | 7.66           | 6.87           |

| Pair                                                 | Ratio                                | Note |
| ---------------------------------------------------- | ------------------------------------ | ---- |
| `volt-ink` on `volt` (button text)                   | 15.19                                |      |
| `volt-ink` on `volt-hover`                           | 16.74                                |      |
| `volt-ink` on `volt-press`                           | 12.25                                |      |
| `ink-100` on each sleeve colour (§8.3)               | 12.1 or more                         |      |
| `ink-400` on the darkest-contrast sleeve (`#2e2e14`) | 5.36                                 |      |
| card ink and face pairs                              | unchanged, `card-and-rarity.md` §4.2 |      |

- **Rule:** no text in `ink-500` (below AA on every surface), as `packs-page.md` §7 already says for `zinc-500`.
- **Rule:** tier text never sits on `night-800`. Epic would be 4.51:1, which passes only by a hair. Tier chips stay on `night-950` or `night-900`, as `card-and-rarity.md` §4.2 already says for chips.
- **Focus ring:** 2 px `volt` with a 2 px offset in the surface colour. It is 11.9:1 or more against every night surface. On a Volt button the offset gap keeps the ring visible against the button's own fill.

## 6. Space, shape and elevation

### 6.1 Spacing

Tailwind's 4 px scale, with these fixed points:

| Use                                 | Value                                          |
| ----------------------------------- | ---------------------------------------------- |
| page gutter                         | 16 px phone (`px-4`), 24 px from `sm` (`px-6`) |
| page container                      | `max-w-6xl`, as today                          |
| eyebrow → title                     | 8 px                                           |
| title → first content               | 24 px phone, 32 px from `sm`                   |
| between page sections               | 64 px (`mt-16`), 80 px on the landing          |
| inside a section, heading → content | 16 px                                          |
| header height                       | 56 px                                          |
| bottom tab bar                      | 64 px + `env(safe-area-inset-bottom)`          |
| touch targets                       | 44 px minimum on a phone (raised from 40 px)   |

### 6.2 Radius

| Token            | Value | Use                                                                          |
| ---------------- | ----- | ---------------------------------------------------------------------------- |
| `radius-card`    | 12 px | cards at every size above thumbnail (the owner's, `card-and-rarity.md` §3.2) |
| `radius-sleeve`  | 14 px | pack sleeves                                                                 |
| `radius-control` | 10 px | buttons, inputs, selects                                                     |
| `radius-chip`    | 8 px  | header chips, filter chips, markers                                          |
| `radius-sheet`   | 16 px | dialogs, the pack sheet, bottom sheets                                       |

No pill buttons. A big radius is used only where a real object is round (the centre tab, §10.2).

### 6.3 Elevation

Depth comes from the four night steps, not from shadows: page `950`, panel `900`, raised `850`, pressed `800`. Hairlines are `night-700`, strong lines `night-600`. Shadows exist only for things above the page:

| Token            | Value                             | Use                                                |
| ---------------- | --------------------------------- | -------------------------------------------------- |
| `shadow-overlay` | `0 16px 48px rgb(0 0 0 / 0.55)`   | dialogs, the account menu                          |
| `shadow-bar`     | `0 -1px 0 var(--color-night-700)` | the bottom tab bar's top edge (a line, not a blur) |

The owner's frame glows (`card-and-rarity.md` §5.2) and the ceremony's tell glows (§7.2) are the only coloured shadows. Nothing else glows: no buttons, panels, chips or text (standards §2, owner exception bounds).

## 7. The card

### 7.1 Card face and frames

Unchanged from `card-and-rarity.md` §3 to §6: 5:7, the night-sky face, the six owner frames, glint and pearl drift, stars, rank chip, the 4.5:1 ink. Changes:

- **Type on the card:** name in Figtree 700; series in Figtree 500; the rank chip in Martian Mono 500 with `tabular-nums`. `card-and-rarity.md` §2 already says the card uses "the app's sans and mono stacks", and those stacks now resolve to these families. The sizes are unchanged. Martian Mono is wider than the system mono: `#0012 / 2983` at 11 px is about 84 px, which fits the 136 px reveal card at 320 px.
- **Stage size** (the ceremony's current card, `pack-opening.md`): 240 × 336 px (the dialog size, 6 px frame, `card-and-rarity.md` §3.2), down to 200 × 280 px when the viewport is under 360 px wide or 640 px tall.

### 7.2 The card back: the Orbit

Every face-down card in the game has the same back. It is drawn in CSS and inline SVG only: no image file and no `data:` URL, because the CSP's `img-src` allows only `'self'` and `s4.anilist.co`.

Top to bottom inside a 5:7 card with the reveal card's radius:

1. **Rim**: a frame in `night-600` (`#3a4070`), the same thickness as a front frame at the same size (`card-and-rarity.md` §3.2): 5 px at reveal size, 6 px at stage size.
2. **Field**: the card face's night gradient (`--card-face`, `card-and-rarity.md` §4.1), with a second, sparser layer of 1 px stars at 30 % opacity (`--card-back-field`, §12).
3. **The Orbit**, centred at 42 % of the height: a 1.5 px ring in `night-600`, 62 % of the card's width across. Six **sockets** sit on the ring at the corners of a hexagon, starting at the top and going clockwise. Each socket is a `✦`-shaped four-pointed star, 9 px at reveal size, unlit in `night-700`. At the ring's centre is a smaller ring, 18 % of the width, empty.
4. **Wordmark**: `Anime TCG` in the display face, weight 800, width 85 %, 13 px at reveal size, `ink-300`, centred at 80 % of the height. Under it, in the mono `eyebrow` style at 8 px, `ink-400`: `Six tiers · one orbit`. The wordmark and line are `aria-hidden`; the back is decorative until it carries a tell.
5. Nothing else: no kanji, no seal, no wave or lattice pattern, no gradient wash, no logo other than the wordmark.

**The tell** (ceremony only, `pack-opening.md` §5): the card's real tier lights its number of sockets, clockwise from the top: 1 for Common up to 6 for Mythic. Lit sockets take the tier's mark colour. The rim takes the tier's flat frame colour (`card-and-rarity.md` §5.2: `#686b73`, `#2fb79c`, `#2a4fa8`, then the flat Epic, Legendary and Mythic colours; Mythic uses the pearl gradient). The glow ladder:

| Tier      | Sockets lit | Rim                | Glow (static)                          | Loops (stop under reduced motion)                 |
| --------- | ----------- | ------------------ | -------------------------------------- | ------------------------------------------------- |
| Common    | 1           | `#686b73`          | none                                   | none                                              |
| Uncommon  | 2           | `#2fb79c`          | none                                   | none                                              |
| Rare      | 3           | `#2a4fa8`          | `--shadow-tell-rare` (16 px, 35 %)     | none                                              |
| Epic      | 4           | `#c22c4b`          | `--shadow-glow-epic` (the frame's own) | `tell-breathe`: glow opacity 0.6 ↔ 1, 1.6 s       |
| Legendary | 5           | `#c27b22`          | `--shadow-glow-legendary`              | `tell-breathe`                                    |
| Mythic    | 6           | the pearl gradient | `--shadow-glow-mythic`                 | `tell-breathe` and the pearl drift (`card-pearl`) |

The tell is the card's true `rarity` from the server's answer (`OpenedCard.rarity`, `DemoCard.rarity`). It is never more. It never steps up from a lower tier on the way, and it never shows a tier that the card then fails to match (ADR 0014 §2). The star count makes it readable without colour.

This extends the owner's frame exception (standards §2, `card-and-rarity.md` §5.4) to the card back in the ceremony. ADR 0014 §1 allows "a tier-coloured glow before a card turns". The bounds are the same: no glow anywhere else, loops stop under reduced motion, and the stars carry the tier.

### 7.3 Card and back sizes

| Use                         | Back used?                                       | Size                                              |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| ceremony, current card      | yes                                              | stage size (§7.1)                                 |
| ceremony, the stack beneath | yes, no tell                                     | stage size, offset 3 px per card, at most 4 shown |
| ceremony tray               | no (empty slot until turned, then the thumbnail) | 32 × 45 px, `radius 4px`                          |
| summary grid                | no                                               | reveal size                                       |
| empty slots anywhere        | no: `night-800` 5:7 box, as today                | grid size                                         |

## 8. Packs as objects: sleeves

A pack is a **sleeve**: a tall foil packet, 5:7.6 (a little taller than a card, so a card fits inside), with a crimped **seam** across the top 12 % and the Orbit printed on its front. You open it by tearing along the seam (`pack-opening.md` §4). It is drawn in CSS and inline SVG, with no image files.

### 8.1 Anatomy

1. **Seam**: the top 12 %, a band 2 % darker than the body with a row of 1 px crimp lines in `night-600`. During the hold, a 2 px **tear line** in `volt` grows along the bottom edge of the seam from left to right. That line is the hold progress.
2. **Body**: the sleeve colour (§8.3), with a faint vertical sheen (a 2-stop gradient, 6 % white at 30 % → 0 at 60 %). It is static: no animated foil.
3. **Orbit**: the same ring and six sockets as the card back, 58 % of the width, at 40 % of the height. **Lit sockets = the floor the pack's rules guarantee**, from server data only:
   - before the server's answer, and for a standard pack: the last slot's published floor (`odds.slots[4].floor`, today Rare, 3 sockets);
   - an Enchanted pack: `odds.enchanted.floor` (Epic, 4);
   - a Radiant pack, or a pack with `pityMythic`: `odds.radiant.lastSlot` (Mythic, 6);
   - a shop pack: its theme's published last-slot floor if `ThemeOffer.odds` carries slots. Otherwise none are lit, and the sleeve's description says only the card count (`pack-opening.md` §10, `floorInside`).
     Sockets only ever go up when the answer arrives (3 → 4 or 6). That is a true tell of what is inside (ADR 0014 §2).
   - **Colours**: the ring is `night-600`; lit sockets take the floor tier's mark colour (`--color-rarity-<tier>`, as on the card back); unlit sockets are `night-700`. On the Radiant sleeve the ring is `#b9addb`, and all six sockets are lit in the Mythic mark colour with a 1 px `sleeve-radiant-ink` outline, so they keep 3:1 against the light body (the Mythic mark alone is 2.0:1 on `#f3eeff`). A Radiant sleeve has no unlit socket.
4. **Name block**, bottom 28 %: the pack's name in the display face (weight 800, width 80 %, 20 px at 180 px wide, `ink-100`). Under it, the mono eyebrow line (`ink-400`), for example `Five cards`.
5. **Kind mark** (top-right, under the seam): only for Enchanted, Radiant and pity. The mono eyebrow `Enchanted`, `Radiant` or `Guaranteed Mythic` in `ink-100` on a `night-950` 60 % chip.

### 8.2 Sleeves per pack kind

| Pack                                     | Sleeve colour (§8.3)                                     | Name block                                | Eyebrow line                     | Where                                      |
| ---------------------------------------- | -------------------------------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------ |
| Timer pack, standard                     | `sleeve-night` `#1f2a44`                                 | `Anime TCG`                               | `Five cards`                     | `/packs` pack sheet, ceremony              |
| Timer pack, Enchanted (after the answer) | `sleeve-night` + a second, outer Orbit ring in `ink-300` | `Anime TCG`                               | `Five cards`                     | ceremony                                   |
| Any pack, Radiant (after the answer)     | `sleeve-radiant` `#f3eeff` with ink `#3a2f66` (10.4:1)   | `Anime TCG`                               | `Five cards`                     | ceremony                                   |
| Shop themed pack                         | the theme's sleeve colour                                | the theme's title (genre), e.g. `Romance` | `<n> cards` (`ThemeOffer.cards`) | `/shop` list (thumbnail 48 × 73), ceremony |
| Demo pack                                | `sleeve-night`                                           | `Anime TCG`                               | `Demo pack · five cards`         | landing hero, `/demo`, ceremony            |

- **Theme sleeve colours** come from the five theme inks of §8.3 (plum, pine, rust, olive, petrol; `sleeve-night` stays the timer pack's). `themeId` picks one by a stable hash: the sum of its UTF-16 code units, mod 5. The same theme keeps its colour when the shop's order changes. It never depends on the theme's odds, so a sleeve colour never hints at rarity. They are dark and low in saturation, so they never read as tier colours.
- Kyara's packs carry a large kanji and a seal. Ours carry the Orbit and the pack's name. There is no glyph or emblem besides those.

### 8.3 Sleeve inks

| Token            | Hex       | `ink-100` on it      |
| ---------------- | --------- | -------------------- |
| `sleeve-night`   | `#1f2a44` | 12.55                |
| `sleeve-plum`    | `#2b1f3d` | 13.53                |
| `sleeve-pine`    | `#13322e` | 12.13                |
| `sleeve-rust`    | `#3a2418` | 12.78                |
| `sleeve-olive`   | `#2e2e14` | 12.18                |
| `sleeve-petrol`  | `#1a2f3f` | 12.14                |
| `sleeve-radiant` | `#f3eeff` | ink `#3a2f66`: 10.39 |

## 9. Motion

### 9.1 Outside the ceremony

The standards' rules still hold (§3: 150–250 ms, motion that explains, nothing loops except the owner's frames). This identity adds only these:

| Name         | What moves                                                                                                               | Duration / easing       | Reduced motion |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | -------------- |
| `page-enter` | the page's eyebrow and title: opacity 0 → 1 and 6 px up, the title 40 ms after the eyebrow                               | 200 ms `ease-out-quint` | none           |
| `value-tick` | a header chip's number when the server changes it: the old number slides up and out, the new one slides up and in (8 px) | 180 ms                  | swap at once   |
| `card-enter` | unchanged (`packs-page.md` §6.3)                                                                                         | 200 ms, 50 ms per slot  | none           |
| `pop-in`     | dialogs and menus, unchanged                                                                                             | 150 ms                  | none           |
| `tab-press`  | bottom-bar item: the icon moves 1 px down while pressed                                                                  | 100 ms                  | none           |

- No hover lift, scale or tilt anywhere (standards §2). Hover changes colour only.
- Nothing pulses for attention. A chip does not pulse when packs are ready or at the cap (`packs-page.md` §6.1, ADR 0004 §6).
- `page-enter` runs on navigation only, not on a load or reload, and never moves focus.

### 9.2 Inside the ceremony

The stage's durations and loops are listed as tokens (§12.6) and specified in `pack-opening.md` §4–§6. ADR 0014 allows longer motion and loops there. Its bounds are these: every effect is skippable; `prefers-reduced-motion` gets the short path; and no effect suggests a tier the card is not.

### 9.3 Easing

| Token              | Value                            | Use                       |
| ------------------ | -------------------------------- | ------------------------- |
| `ease-out-quint`   | `cubic-bezier(0.22, 1, 0.36, 1)` | entrances, settling cards |
| `ease-in-out-sine` | `cubic-bezier(0.37, 0, 0.63, 1)` | loops (breathe, pearl)    |
| `ease-snap`        | `cubic-bezier(0.5, 0, 0.1, 1)`   | the flip, the tear        |

## 10. Page patterns

### 10.1 Page header (every page)

```
EYEBROW (mono, 11–12 px, ink-400, uppercase, 0.12em)
Title (display, the `title` size, ink-100)
optional one-line stat (sans 14 px, ink-300, numbers in `num`)
```

- Left-aligned (as `navigation-and-landing.md` §5.2). The `h1` is the title. It keeps `tabindex="-1"` and gets focus on navigation (`navigation-and-landing.md` §3.6). The eyebrow is a `<p aria-hidden="true">` before it and carries no information that is not elsewhere on the page.
- The radial violet page background goes (debt, `navigation-and-landing.md` §6.1). The page is flat `night-950`. Only the landing hero and the ceremony stage have a background of their own (§11, `pack-opening.md`).

| Page                        | Eyebrow (sentence case in source; shown uppercase) | Title (`h1`, unchanged)     | Stat line                             |
| --------------------------- | -------------------------------------------------- | --------------------------- | ------------------------------------- |
| `/`                         | `Anime character cards`                            | `Anime TCG` (`hero` size)   | — (the lede, §11)                     |
| `/demo`                     | `Try a pack` (idle page and summary, S7)           | `Demo pack`                 | —                                     |
| `/packs`                    | `Timer packs`                                      | `Packs`                     | — (the pack sheet holds the counts)   |
| `/packs/open`, `/shop/open` | `Timer packs`, `Themed packs` (summary, S7)        | `Pack opening`, `Shop pack` | —                                     |
| `/collection`               | `Your cards`                                       | `Collection`                | the collection's existing totals line |
| `/shop`                     | `Themed packs`                                     | `Shop`                      | —                                     |
| `/market`                   | `Player trades`                                    | `Market`                    | —                                     |
| `/profile`                  | `Player`                                           | `Profile`                   | —                                     |
| `/account`                  | `Settings`                                         | `Manage account`            | —                                     |
| `/login`                    | `Welcome back`                                     | `Log in`                    | —                                     |
| `/register`                 | `Invite only`                                      | `Register`                  | —                                     |
| not found                   | `404`                                              | `Page not found`            | —                                     |

- **The opening pages** (`/packs/open`, `/shop/open`, `/demo`) have no eyebrow while the stage shows (S0–S6): the `h1` itself is set in the eyebrow style in the stage's top bar (`pack-opening.md` §7). The summary (S7) uses the pattern above, with the eyebrow of the page the pack came from. `Your pack` is never an eyebrow: it is the reveal's `h2` (`pack-opening.md` §8).

### 10.2 Header and progress chips

**Desktop and `sm`** (signed in): wordmark (display, 800, 85 %, 20 px, `ink-100`), then the page links, then on the right two **chips** and the Account control. Signed out: wordmark, `Log in`, `Register`, as today.

- **Page links** (they replace the tab group's look, §13): plain links in sans 600 14 px, `ink-400`, with no fill and no box. Hover is `ink-100`. The current page (`aria-current="page"`) is `ink-100` with a 2 px `volt` underline at the bottom of its 44 px target. There is no pill or background.
- **Account control**: its contents, menu and rules stay as `accounts.md` §3.5 has them. The restyle: `night-850` fill, 1 px `night-700` border, `radius-control`, 44 px tall. Below 640 px it shows the avatar alone in a 44 × 44 control, and the login stays in its accessible name.

| Chip            | Shows                                                                                             | Accessible name      | Source                                                          | Link to           | From PR                         |
| --------------- | ------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- | ----------------- | ------------------------------- |
| **Packs ready** | a 12 × 18 px sleeve glyph (inline SVG, `aria-hidden`), then `2/3` in `num`                        | `2 of 3 packs ready` | the last applied allowance (`packs-page.md` §3.1 step 5)        | `/packs`          | PR 2 (§15)                      |
| **Karma**       | `1,240` in `num`, `ion`, then `Karma` in `xs` `ink-400`. No icon (owner, `market-and-shop.md` §6) | `1,240 Karma`        | the wallet balance, unchanged rules (`market-and-shop.md` §3.1) | none (plain text) | PR 2, once economy is on `main` |

- Chips are `radius-chip`, `night-850` fill, 1 px `night-700` border, 32 px tall (the 44 px touch target comes from padding on the link), 8 px gap.
- **Packs ready is a count, never a nudge.** It has no countdown and no badge colour. It does not pulse, it does not change when the cap is reached, and it does not change the title or favicon. When the number changes, it uses `value-tick` and nothing else. It is not a live region. To fill it at sign-in, the signed-in layout sends one `GET /api/packs`, then applies every later allowance answer under the newest-request-wins rule. It never polls (`packs-page.md` §3.2).
- **No pity chip.** The guarantee counter stays a plain line on `/packs` (`card-and-rarity.md` §7.4, owner's placement). See §16 decision 3.
- The Karma chip is plain text in a chip, not a button. It changes with `value-tick` when an answer carries a new balance (`ShopReceipt`, `RecycleReceipt`, `PurchaseReceipt`).

### 10.3 Phone: the bottom tab bar

Below 640 px, signed in, the page links leave the header and sit in a **bottom tab bar**. The header keeps the wordmark, the two chips and the Account control in one 56 px row. At 320 px that is wordmark (≈ 92 px) + chips (≈ 56 + 92 px) + Account (44 px) + gaps. If the Karma chip does not fit, it drops the word `Karma` visually (the accessible name keeps it) below 360 px.

| Slot | Item (`aria-current` rules as today) | Icon (Lucide, 22 px, `aria-hidden`) | Label (11 px sans 600) |
| ---- | ------------------------------------ | ----------------------------------- | ---------------------- |
| 1    | `/shop`                              | `Package`                           | `Shop`                 |
| 2    | `/market`                            | `ArrowLeftRight`                    | `Market`               |
| 3    | `/packs` (**centre**)                | the sleeve glyph (§8)               | `Packs`                |
| 4    | `/collection`                        | `LayoutGrid`                        | `Collection`           |
| 5    | `/profile`                           | `CircleUser`                        | `Profile`              |

- **Before item 2 ships** (no Shop or Market on `main`), the bar has three slots: `Collection`, **Packs** in the centre, `Profile`. Each slot appears in the PR that builds its page (`navigation-and-landing.md` §3.1 rule 1).
- **Centre item**: a 56 px Volt circle (`volt` fill, `volt-ink` glyph) raised 12 px above the bar, with its label under it. It is a link to `/packs`, never a button that opens a pack: a pack opens from the pack sheet, so the player always sees the odds and the count first. When packs are ready it shows the count in a 18 px `night-950` chip on its top-right (`num`, `ink-100`), for example `2`. The chip has no colour change, no pulse and no number at zero. Its name is `Packs, 2 of 3 ready`.
- The other items: `ink-400` icon and label; current: `ink-100`, plus a 2 × 16 px `volt` bar above the icon. They have no fill.
- `Collection` drops its `(<N>)` in the bar. The count is on the collection page, and the accessible name stays `Collection`. This replaces `navigation-and-landing.md` §5.1's `sr-only` trick below 400 px.
- Bar: `night-900`, `shadow-bar`, `position: fixed; bottom: 0`, height 64 px + `env(safe-area-inset-bottom)`. `index.html` gains `viewport-fit=cover` in its viewport meta. `<main>` gets matching bottom padding so nothing hides under the bar.
- The bar is a `<nav aria-label="Main">` (the header's link group is then not rendered below 640 px, so there is one Main nav). It is hidden during the ceremony stage (`pack-opening.md` §7) and when a dialog is open.
- Signed out, there is no bar. The header shows `Log in` and `Register`, as today.
- **Icons**: `lucide-react` (ISC licence) is a new dependency, T2 review in PR 3 (§15). It is tree-shaken to the five icons. The alternative is to copy those five SVG paths inline with the ISC notice. Neither the shop icon nor any other is a cart, bag, store front or coin (`ui-designer` brief: no store iconography).

### 10.4 Buttons and controls

| Kind                         | Rest                                                                                     | Hover                | Pressed                        | Disabled / `aria-disabled`       |
| ---------------------------- | ---------------------------------------------------------------------------------------- | -------------------- | ------------------------------ | -------------------------------- |
| Primary                      | `volt` fill, `volt-ink` text, sans 700 15 px, 44 px (48 phone), `radius-control`, `px-5` | `volt-hover`         | `volt-press`                   | `night-800` fill, `ink-500` text |
| Secondary                    | `night-850` fill, 1 px `night-600` border, `ink-100` text                                | `night-800` fill     | `night-800` + border `ink-400` | as primary disabled              |
| Text                         | `ink-300`, no fill                                                                       | `ink-100`, underline | —                              | `ink-500`                        |
| Danger (delete account only) | `night-850`, 1 px `danger` border, `danger` text                                         | `night-800`          | —                              | as above                         |

- No gradients, shadows, scale or lift. One primary per view, as today.
- `BUTTON`, `INPUT`, `DISABLED` and `ERROR_TEXT` in `web/src/components/account/styles.ts` take these values. Every page follows, because they all use those constants.

## 11. Pages

### 11.1 Everywhere

- **Background**: `night-950`. The old radial violet wash goes.
- **Footer**: unchanged words (`navigation-and-landing.md` §8). It gains a second line in `xs` `ink-400`: `Fonts: Bricolage Grotesque, Figtree, Martian Mono (SIL Open Font License).`, with the licence name linking to `/licenses/fonts.txt` (§4.1).
- **Empty states**: an Orbit (the card back's ring and sockets, unlit, 96 px, `aria-hidden`) above the existing empty sentence and its link. There is no grey dashed box.
- **Skeletons**: `night-800` blocks, static (no shimmer), as today.

### 11.2 Landing page (`/`): art up front

All rules of `navigation-and-landing.md` §3.7 stand except the ones listed in §13. Top to bottom:

1. **Hero** (`<section aria-labelledby="landing-heading">`). Its background is the **horizon**: on `night-950`, a huge Orbit ring (1.5 px `night-700`, 160 % of the viewport width across) whose top arc crosses the hero's lower third. The `--card-back-field` star layer sits above it. It is static and has no colour wash or glow.
   - **Text column** (left from 640 px): eyebrow `Anime character cards`; `h1` `Anime TCG` at `hero` size; the lede (unchanged copy, `body` → `lg` 18 px from `sm`, `ink-300`); `Open a demo pack` as a primary button; the disclosure under it (`small`, `ink-400`).
   - **Art column** (right from 640 px; **above the lede on a phone**, 250 px tall): the demo **sleeve** (§8.2) at reveal size, with up to **three showcase cards** fanned behind it. The cards are at reveal size, offset so the sleeve covers their lower third. From left to right they are the Legendary at −9°, the Epic at −3° and the Rare at +5°. They are real cards (`card-and-rarity.md` card, every face part) from the server's showcase (§16 decision 1). They show the tier frame, and they play no glint, drift or glow, which is the landing's existing no-effect rule. All of it is `aria-hidden`. It does not move on hover, scroll or load. On a phone, the cards shrink to 110 px wide (154 px tall) and the sleeve to 96 px **wide** (146 px tall at 5:7.6). Rotated, with the sleeve over their lower third, they need the 250 px column.
   - **Without a showcase** (the facts loading, no pool, or PR 6a not yet on `main`): the sleeve alone. Nothing is grey or empty. On a phone the column keeps its 250 px and the sleeve keeps its place at the column's foot, so the lede does not move when the showcase arrives. Only if PR 6 ships before PR 6a, the phone column is 160 px until 6a lands.
   - At 320 × 568 (measured in the mockup): `Open a demo pack` ends at 550 px, above the fold. The disclosure under it starts below the fold there, and is above the fold from 375 × 667. That is accepted: it is still directly under the button, before any press, as `navigation-and-landing.md` §3.7 item 1.3 asks.
2. **Tiers band** (new, `h2` `Six tiers`): six small cards in a row, one per tier, drawn as **card backs with their tell lit**: 1 to 6 sockets, rim in the tier colour, static, no glow. Each has the tier word under it in its text colour. They scroll sideways in one row on a phone, each card 92 px wide (`overflow-x: auto` with `scroll-snap`, the list is `role="list"`), and fit in one row from `sm`. This shows how to read the Orbit before the first pack. It uses no server data. The tier words are the only text, so the band adds no copy rule.
3. **How it plays**: the numbered steps, as today, with the number in the display face at 40 px `ink-500` (decorative, `aria-hidden`), the term in `subhead` and the sentence in `small` `ink-300`. Still one column, no icons, no three-across row.
4. **Pack odds**: the table as today, with one new column, a **bar**, placed between `Tier` and the figure. The bar is the tier's `perPack` over `scale` as the width of an 80 px track, 6 px tall (`night-800` track, the tier's mark colour fill). Its width is linear, with a 2 px minimum so Mythic's 0.25 % is visible as a tick. The bar is `aria-hidden`, and the figure next to it carries the number. The same bar goes into the `Pack odds` dialog (`card-and-rarity.md` §7.3, column `At least one per pack`).
5. **Join**, then the footer, as today.

### 11.3 `/packs`: the pack sheet

The control block (`packs-page.md` §5.1) becomes a **pack sheet**: a `night-850` sheet, `radius-sheet`, `p-5`, `max-w-xl`. From 640 px it has two columns: the timer sleeve (§8.2) at 140 px wide on the left, the existing control block on the right. On a phone the sleeve sits above the block at 120 px wide, left-aligned. The block's contents, order, states and copy do not change: count line, `Open pack`, line under the button, countdown, pity line and `Pack odds`, `See your latest pack`. The count line becomes `num` style. The sleeve is `aria-hidden` and not a control. It shows the standard floor (3 lit sockets), because the next pack's kind is never shown (`card-and-rarity.md` §7.1). It stays in place, unchanged, in the block's loading and load-failure states: its sockets come from the held odds, not from the allowance. With no odds held at all, it lights no socket (§8.1: server data only).

### 11.4 Collection, shop, market

- **Collection**: the page header (§10.1) with the totals as the stat line. Tiles, chips, dialog and states are unchanged apart from the new tokens. The empty state uses the Orbit (§11.1).
- **Shop**: each theme row gains its sleeve thumbnail (48 × 73) at the start of the row. The price uses `num`, `ink-200`. The words and order are unchanged (`market-and-shop.md` §3.3), and so is the button (`Buy…`, primary).
- **Market**: tokens only. Prices in `num`.

### 11.5 Copy voice

Our voice is a dry, friendly game master. It speaks to the player in short sentences with the verb first. It names things with game words (pack, sleeve, tear, turn, tier, orbit) and keeps numbers as numbers. It has some personality, but no hype. Every existing copy rule still holds: the forbidden-word lists of `navigation-and-landing.md` §8 and `collection-overview.md` §8, no exclamation marks, no urgency or scarcity, no "free" outside "free pack(s)", no "another" or "one more", and no comment on what a pack contained.

| Say                    | Not                                                                         |
| ---------------------- | --------------------------------------------------------------------------- |
| `Hold to tear it open` | `Hold the seal to break it` (kyara's), `Click here to open your pack!`      |
| `Tap to turn`          | `Reveal your card!`                                                         |
| `Already yours`        | `Duplicate` (it is often a different tier of a character you have), `Dupe!` |
| `2 of 3 packs ready`   | `You have 2 packs available to open!`                                       |
| `Back to packs`        | `Open another`, `One more?`                                                 |
| `Six tiers`            | `Collect them all!`                                                         |
| `Your pack`            | `Nice pull!`, `So lucky`                                                    |

New strings are listed exactly in the spec that uses them: `pack-opening.md` §10 for the ceremony, and this spec's §10.1 for eyebrows, §10.3 for tab labels and §11 for the landing. The copy test scans them all.

## 12. Tokens (for `web/src/index.css`)

Tailwind 4 `@theme` names become utilities (`bg-night-900`, `text-ink-300`, `font-display`, `text-title`, `rounded-control`, `shadow-overlay`, `ease-out-quint`, `animate-tell-breathe`). Values that are not Tailwind theme keys go in `:root`.

### 12.1 Colours (`@theme`)

| Token                        | Value                                |
| ---------------------------- | ------------------------------------ |
| `--color-night-950`          | `#07080f`                            |
| `--color-night-900`          | `#0e1020`                            |
| `--color-night-850`          | `#151830`                            |
| `--color-night-800`          | `#1d2140`                            |
| `--color-night-700`          | `#2a2f55`                            |
| `--color-night-600`          | `#3a4070`                            |
| `--color-ink-100`            | `#eef0fa`                            |
| `--color-ink-200`            | `#dde0ee`                            |
| `--color-ink-300`            | `#c3c7dc`                            |
| `--color-ink-400`            | `#9aa0bd`                            |
| `--color-ink-500`            | `#6e7493`                            |
| `--color-volt`               | `#c8f031`                            |
| `--color-volt-hover`         | `#d9f86a`                            |
| `--color-volt-press`         | `#b3d924`                            |
| `--color-volt-ink`           | `#07080f`                            |
| `--color-ion`                | `#5cd6f5`                            |
| `--color-danger`             | `#ff9b8f`                            |
| `--color-sleeve-night`       | `#1f2a44`                            |
| `--color-sleeve-plum`        | `#2b1f3d`                            |
| `--color-sleeve-pine`        | `#13322e`                            |
| `--color-sleeve-rust`        | `#3a2418`                            |
| `--color-sleeve-olive`       | `#2e2e14`                            |
| `--color-sleeve-petrol`      | `#1a2f3f`                            |
| `--color-sleeve-radiant`     | `#f3eeff`                            |
| `--color-sleeve-radiant-ink` | `#3a2f66`                            |
| `--color-back-rim`           | `#3a4070` (= night-600)              |
| `--color-back-socket`        | `#2a2f55` (= night-700)              |
| rarity and card tokens       | unchanged (`card-and-rarity.md` §10) |

**Migration in PR 1:** to restyle every existing page in one small PR, `@theme` also **redefines Tailwind's `zinc` steps used in `web/`** to the night and ink values: `zinc-950` → `#07080f`, `900` → `#0e1020`, `800` → `#1d2140`, `700` → `#2a2f55`, `600` → `#3a4070`, `500` → `#6e7493`, `400` → `#9aa0bd`, `300` → `#c3c7dc`, `200` → `#dde0ee`, `100` → `#eef0fa`. `violet-500`/`600` (focus ring, primary) are not remapped: `styles.ts` switches them to `volt`. `red-300` → `danger` in `ERROR_TEXT`. New code uses the semantic names. A later chore PR replaces the remaining `zinc-*` class names and drops the override. The contrast figures in existing specs that cite `zinc-*` are then these values (§5.4), and every one of them is still at least as high as before.

### 12.2 Type (`@theme`)

| Token              | Value                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--font-display`   | `"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif`                                                                                                                                   |
| `--font-sans`      | `"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"`                                                                     |
| `--font-mono`      | `"Martian Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`                                                                                                                      |
| `--text-hero`      | `3rem`; `--text-hero--line-height: 0.9`; `--text-hero--letter-spacing: -0.02em`; `--text-hero--font-weight: 800` (and `sm:text-[4.5rem]`, `lg:text-[6rem]` via the responsive variants in the component) |
| `--text-title`     | `2.25rem`; line height `0.95`; letter spacing `-0.015em`; weight `800`                                                                                                                                   |
| `--text-section`   | `1.5rem`; line height `1.05`; letter spacing `-0.01em`; weight `750`                                                                                                                                     |
| `--text-eyebrow`   | `0.6875rem`; line height `1.2`; letter spacing `0.12em`; weight `500`                                                                                                                                    |
| `--text-tier-word` | `clamp(3.5rem, 18vw, 10rem)`; line height `0.85`; letter spacing `0.01em`; weight `800`                                                                                                                  |

`:root`: `--display-stretch: 85%`, `--tier-word-stretch: 75%` (applied with `font-stretch` by the `font-display` utilities that need it; `@utility display-tight { font-family: var(--font-display); font-stretch: var(--display-stretch); }` and `@utility tier-word { … font-stretch: var(--tier-word-stretch); text-transform: uppercase; }`).

### 12.3 Radius and shadow (`@theme`)

| Token                | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| `--radius-card`      | `12px`                                                  |
| `--radius-sleeve`    | `14px`                                                  |
| `--radius-control`   | `10px`                                                  |
| `--radius-chip`      | `8px`                                                   |
| `--radius-sheet`     | `16px`                                                  |
| `--shadow-overlay`   | `0 16px 48px rgb(0 0 0 / 0.55)`                         |
| `--shadow-bar`       | `0 -1px 0 #2a2f55`                                      |
| `--shadow-tell-rare` | `0 0 16px rgb(111 149 236 / 0.35)`                      |
| glows Epic to Mythic | unchanged (`--shadow-glow-*`, `card-and-rarity.md` §10) |

### 12.4 Easing and motion (`@theme`)

| Token                    | Value                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `--ease-out-quint`       | `cubic-bezier(0.22, 1, 0.36, 1)`                                                              |
| `--ease-in-out-sine`     | `cubic-bezier(0.37, 0, 0.63, 1)`                                                              |
| `--ease-snap`            | `cubic-bezier(0.5, 0, 0.1, 1)`                                                                |
| `--animate-page-enter`   | `page-enter 200ms var(--ease-out-quint) both` (opacity 0 → 1, `translateY(6px)` → 0)          |
| `--animate-value-tick`   | `value-tick 180ms var(--ease-out-quint) both` (`translateY(8px)`, opacity 0 → 1)              |
| `--animate-tell-breathe` | `tell-breathe 1.6s var(--ease-in-out-sine) infinite` (the glow layer's opacity 0.6 → 1 → 0.6) |

Every one is wrapped with `motion-reduce:animate-none` where it is used. `tell-breathe` is only used inside the ceremony stage.

### 12.5 Surfaces and drawings (`:root`)

| Token               | Value                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--card-back-field` | `radial-gradient(circle at 12% 30%, rgb(255 255 255 / .3) 0 1px, transparent 1.5px), radial-gradient(circle at 84% 64%, rgb(255 255 255 / .3) 0 1px, transparent 1.5px), radial-gradient(circle at 30% 86%, rgb(255 255 255 / .25) 0 1px, transparent 1.5px), var(--card-face)` |
| `--sleeve-sheen`    | `linear-gradient(100deg, transparent 30%, rgb(255 255 255 / .06) 45%, transparent 60%)`                                                                                                                                                                                         |
| `--stage-bg`        | `radial-gradient(120% 80% at 50% 110%, #151830 0%, #07080f 60%)` plus the `--card-back-field` star layers at 20 % scale, repeated                                                                                                                                               |
| `--stage-tint`      | `transparent` by default; `pack-opening.md` §6 sets it per tier (`rgb(<tier mark> / .14)` as a radial at the stage centre)                                                                                                                                                      |

All are CSS gradients. No `url()` to an image, so `img-src` does not change.

### 12.6 Ceremony timings (`:root`, used by `pack-opening.md`)

| Token                         | Value    |
| ----------------------------- | -------- |
| `--stage-sleeve-in`           | `320ms`  |
| `--stage-tear-hold`           | `700ms`  |
| `--stage-tear-unwind`         | `150ms`  |
| `--stage-burst`               | `650ms`  |
| `--stage-tell-in`             | `250ms`  |
| `--stage-flip`                | `360ms`  |
| `--stage-settle`              | `250ms`  |
| `--stage-spotlight-epic`      | `1400ms` |
| `--stage-spotlight-legendary` | `2000ms` |
| `--stage-spotlight-mythic`    | `2600ms` |
| `--stage-reveal-all-step`     | `60ms`   |

The ceremony module reads the same numbers from one typed config (`web/src/lib/ceremonyTimings.ts`), so the CSS and the state machine cannot drift. A unit test compares the two.

## 13. What this changes in other specs

These passages are superseded **when the build PR named here lands**. Each build PR edits the spec it touches.

| Spec and passage                                                                                                                               | Superseded by                                                                                               | PR  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --- |
| `navigation-and-landing.md` §6.1 (wordmark classes, tab group look, radial background note), §6.3 (`h1` classes)                               | §10.1, §10.2, §10.4                                                                                         | 1   |
| `navigation-and-landing.md` §5.1 (phone header with the links in row 2), `market-and-shop.md` §5.1                                             | §10.2, §10.3                                                                                                | 3   |
| `navigation-and-landing.md` §6.2 "Type … no web font … one type family"                                                                        | §4                                                                                                          | 1   |
| `navigation-and-landing.md` §3.7 item 1.8 and §6.2 (the static pack drawing; "no … card fans, floating cards"), §5.3 (phone hides the drawing) | §11.2 (the sleeve and the showcase fan; static, `aria-hidden`)                                              | 6   |
| `packs-page.md` §6.1 (`BUTTON.primary` flat violet), §7 contrast table                                                                         | §10.4, §5.4                                                                                                 | 1   |
| `packs-page.md` §5.1 control block                                                                                                             | §11.3 (the pack sheet; same contents)                                                                       | 4   |
| `market-and-shop.md` §6 balance "no box, no colour of its own" (the owner's "no icon" stays)                                                   | §10.2 Karma chip                                                                                            | 2   |
| `packs-page.md` §2 "badge … about packs" for the header                                                                                        | §10.2 Packs ready chip and §10.3 centre count (bounded: no motion, colour or title change) — §16 decision 3 | 2   |
| `card-and-rarity.md` §7.3 odds table                                                                                                           | gains the bar column (§11.2 item 4)                                                                         | 6   |

## 14. Kyara: taken, changed, left out

| Kyara                                                                     | Ours                                                                          | Status                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| Character art everywhere (52 images on home)                              | Showcase fan, tier band of card backs, sleeves, Orbit empty states            | principle taken                 |
| Unbounded (wide, round heavy display)                                     | Bricolage Grotesque, condensed heavy                                          | own choice                      |
| Zen Kaku Gothic New body                                                  | Figtree                                                                       | own choice                      |
| JetBrains Mono for numbers and labels                                     | Martian Mono                                                                  | own choice                      |
| Warm near-black, orange action, yellow reward                             | Cool night blue-black, Volt (yellow-green) action, Ion (cyan) reward          | own choice                      |
| Kanji seals and emblems on packs and backs                                | The Orbit: a ring with six tier sockets                                       | own motif                       |
| Wave-pattern card back with a red seal                                    | Night-sky back with the Orbit and our wordmark                                | own design                      |
| "Hold the seal to break it"                                               | "Hold to tear it open"                                                        | own wording                     |
| Eyebrow + huge title per page                                             | Same pattern, our type and words                                              | principle taken                 |
| Header chips: packs, currency, pity, missions                             | Packs ready and Karma only                                                    | narrowed (no pity, no missions) |
| Phone tab bar with a central Open                                         | Tab bar with a central Packs link (not an opener)                             | adapted                         |
| 24 running animations, pulsing splash                                     | A few short entrances; loops only on the owner's frames and the ceremony tell | narrowed                        |
| Feeds, top collectors, reviews, streaks, missions, referrals, "ends soon" | none                                                                          | left out (nudges)               |
| Pill CTA that glows and rises                                             | Flat Volt button, no glow or lift                                             | left out                        |

## 15. Build order

Each PR is small, is shippable on its own on `main`, and leaves the app consistent. Tests are part of each.

| #   | Branch                        | Contents                                                                                                                                                                                                                                                        | Tier                                                          | Depends on |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- |
| 1   | `feat/identity-tokens`        | The three font packages (§4.1), `/licenses/fonts.txt` and the footer line; all tokens of §12.1–§12.4; the `zinc` remap; `styles.ts` buttons, inputs and error text; flat background; page header pattern (§10.1) on every page; `page-enter`. No layout change. | **T2** (new dependencies)                                     | —          |
| 2   | `feat/header-chips`           | Packs ready chip (one `GET /api/packs` at sign-in, newest-request-wins), Karma chip (restyle of the existing balance), `value-tick`                                                                                                                             | T1                                                            | 1          |
| 3   | `feat/phone-tab-bar`          | The bottom tab bar (§10.3), header row on phone, `viewport-fit=cover`, `lucide-react`                                                                                                                                                                           | **T2** (new dependency)                                       | 1, 2       |
| 4   | `feat/card-back-and-sleeves`  | The card back (§7.2, without the tell's animation), the sleeves (§8) and their tests (socket count from server data); the pack sheet on `/packs` (§11.3); sleeve thumbnails on `/shop`; Orbit empty states                                                      | T1                                                            | 1          |
| 5   | `feat/opening-ceremony`       | `pack-opening.md` in full for `/packs/open` and `/shop/open`: state machine, stage, tell, spotlight, summary, sound, reduced motion; the §12.5–§12.6 tokens                                                                                                     | **T3** (ADR 0014: security review for C1/C20, truthful tells) | 4          |
| 6   | `feat/landing-identity`       | The landing (§11.2): horizon, sleeve, tier band, odds bars (landing and the `Pack odds` dialog); the showcase fan if the server field exists                                                                                                                    | T1                                                            | 4          |
| 6a  | `feat/demo-showcase` (server) | `GET /api/demo` gains `showcase` (§16 decision 1)                                                                                                                                                                                                               | T2                                                            | —          |
| 7   | `feat/demo-ceremony`          | `/demo` on the ceremony, frame effects on (`pack-opening.md` §9, §16 decision 2)                                                                                                                                                                                | T1                                                            | 5          |
| 8   | `chore/zinc-to-night`         | Rename the remaining `zinc-*` classes to `night`/`ink` and drop the remap                                                                                                                                                                                       | T0                                                            | 1          |

PRs 2, 3 and 4 can run in parallel after PR 1. PR 6 needs only PR 4. PR 6a can land any time before 6, and PR 6 ships without it if it has not.

## 16. Decisions (owner, 2026-10-31)

The owner answered all three questions after seeing the two mockups ([redesign pages](https://claude.ai/artifact/MGFEYGyE3ZsWqiQ4MrS1eH), [pack opening](https://claude.ai/artifact/Qg7szqQYhsKyXcwQYtJTp7); `docs/mockups/`): "For the redesign, go with the extra frames and animations." Question 2 is that sentence's own subject. Questions 1 and 3 are the manager's reading of it as "the richer variant" of each. The owner may revise those two.

| #   | Question                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                      | Where                                   |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| 1   | Art on the landing page     | **A**: the showcase fan. The server adds `showcase` to `GET /api/demo` (PR 6a): three characters it picks, the top-ranked Legendary, Epic and Rare, each from a different franchise, fixed per snapshot and cached with the facts. It is truthful (real tiers, real frames) and is not a feed of anyone's pulls. The landing fans them behind the sleeve, static, with no effects. This lifts `navigation-and-landing.md` §6.2's "no card fans" for this one static fan. Not taken: **B** (the sleeve and the tier band only), **C** (five Mythics, which overstates what a pack holds). | Owner, 2026-10-31 (manager's reading; the owner may revise) | §11.2, §15 PRs 6 and 6a                 |
| 2   | Effects on the demo's cards | **A**: on `/demo` the ceremony runs in full and the cards show their frame effects (glow, glint, pearl drift), so the demo shows what the game shows. This **overrides the owner's 2026-10-29 decision** that the demo card has no glow, glint or drift (`card-and-rarity.md` §12 note, standards §2 owner exception), from PR 7 on. The landing's showcase fan stays static and plays no effect. Not taken: **B** (the ceremony without frame effects on `/demo`).                                                                                                                      | Owner, 2026-10-31, the owner's own words                    | `pack-opening.md` §9, §15; §15 PR 7     |
| 3   | What the header shows       | **A**: the `Packs ready` and `Karma` chips, with no motion, colour or title change, plus the same count on the phone's centre tab. Pity stays a plain line on `/packs`, as the owner placed it (`card-and-rarity.md` §7.4). This relaxes `packs-page.md` §2's "no badge" within those bounds. Not taken: **B** (a pity chip, which moves the "least nudge" counter into every header), **C** (Karma only, no pack count outside `/packs`).                                                                                                                                               | Owner, 2026-10-31 (manager's reading; the owner may revise) | §10.2, §10.3, §13; `pack-opening.md` §7 |

**Taken from the mockups into this spec** (2026-10-31, from their "not in spec" lists): the desktop page links and the Account control (§10.2), the sleeve's socket colours and the Radiant sleeve's ring (§8.1), the fan's order by tier (§11.2), the tier band's 92 px phone cards, the odds bar's place and height (§11.2), and the `/packs` sleeve in the loading and failed states (§11.3). The fan's offsets, the hero's star tile and the horizon's exact edge stay as drawn in the mockup, as a reference and not a rule.
