# Card and rarity

The card's anatomy, the six rarity tiers and their frames, as the owner chose them on 2026-10-29 · applies to the 1c web PR (pack reveal, odds), the collection overview (`collection-overview.md`), the market (`market-and-shop.md`) and the landing page's demo pack (`navigation-and-landing.md` §3.7) · server side: `collection-packs.md` (tiers, odds, the snapshot), as shipped in #28 · written 2026-10-29, reconciled the same day with 1c's shipped contract (#28) and the page addresses (#30)

> **Source of the visuals.** The owner chose every frame in the mixer board of the design canvas (claude.ai artifact `VowLMJH1haUPBZkPusw3q6`, file `project/Mixer.dc.html`, its `DEFAULT` mix and its frame table `F`, read on 2026-10-29). The values below are copied from that table unchanged, except one text colour made AA-safe (§4.2). This spec supersedes the five-tier hue ladder that `collection-overview.md` §6.1 had.

## 1. Goal

One card, drawn the same way everywhere a character is shown as a card: in a pack reveal, in the collection grid, in the card dialog, on the market and in the landing page's demo pack. The card names the character, shows its tier as one to six stars under the name, its art, its popularity rank in the snapshot and its series. The tier also sets the frame, from flat grey for Common to a shifting pearl for Mythic. Rarity is never carried by colour alone: the stars carry it, and so does the tier word wherever the card is described in text.

## 2. Out of scope

- The tier rules, odds and pack rules themselves (`collection-packs.md` §5.1.4 and §5.4, six tiers as shipped in #28). This spec shows what the server publishes.
- The pack control, countdown and reveal sequence (the 1c web PR's UI spec, `collection-packs.md` §8). This spec gives the card they reveal and the plain lines about the special packs (§7).
- Masterwork variants and Relics (`collection-overview.md` §2). The card keeps room for a variant marker beside the stars (§3.1).
- Fonts. The mixer used display fonts for its own board; the card uses the app's sans and mono stacks.
- Stats on the card (attack, health, cost): there are none (owner, 2026-10-29).

## 3. Card anatomy

### 3.1 Parts, top to bottom

The card is a **frame** (the tier's treatment, §5) holding a **face** (the night sky, §4.1). On the face:

1. **Name**: the character's name, one line, truncated with `title` holding the full name.
2. **Stars**: the tier marker, 1 to 6 `✦` on their own line under the name (§6). A later variant marker (Masterwork) sits after the stars on this line.
3. **Art**: the AniList image, filling the space between the stars and the series, `object-fit: cover`, `object-position: center top` (faces are near the top of a 3:4 portrait), on the art placeholder while loading or when it fails (§3.3). The **rank chip** sits in the art's bottom-left corner (§6.2).
4. **Series**: the primary series' title (`franchiseIds[0]`), one line, truncated with `title`.

Nothing is drawn over the art except the rank chip: no gradient scrim, no badges.

The rarity shown is the card's **granted** rarity (`entry.rarity`, the card's own), never the character's current tier; the two differ only after a snapshot moved the character (`collection-overview.md` §3).

### 3.2 Sizes

The card's aspect is **5:7** at every size (the mixer's 180 × 252).

| Use                                                               | Size                                                                                                                            | Frame (padding)                                  | Radius outer / face | Name       | Stars | Series | Rank       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------- | ---------- | ----- | ------ | ---------- |
| **Reveal** (free pack on `/packs`, shop pack, demo pack)          | 180 × 252 px from 640 px; below 640 px fluid in a 2-column grid (`gap-4`), at 320 px 136 px wide                                | 5 px                                             | 12 / 8 px           | 13 px bold | 11 px | 12 px  | 11 px mono |
| **Collection and market tile**                                    | fluid, the grid's column (`collection-overview.md` §5.1: at least 168 px, 138 px at a 320 px viewport), height 7/5 of the width | 5 px                                             | 12 / 8 px           | 13 px bold | 11 px | 12 px  | 11 px mono |
| **Dialog** (card dialog, listing dialog, recycle and buy results) | 240 × 336 px from 640 px; below 640 px 200 × 280 px, centred above the heading                                                  | 6 px                                             | 14 / 9 px           | 17 px bold | 14 px | 15 px  | 13 px mono |
| **Thumbnail** (My listings rows)                                  | 48 × 67 px                                                                                                                      | 3 px, the flat frame colour of every tier (§5.2) | 6 / 4 px            | —          | —     | —      | —          |

- Face padding (small sizes): the name block `9px 10px 7px` with a `3px` gap between name and stars; the art `margin: 0 8px`, radius 6 px; the series `9px 10px`. Dialog size: the same multiplied by 4/3 and rounded.
- Below 160 px of width the name and series stay at their sizes and truncate; the stars never wrap (six stars need 66 px).
- The thumbnail is the art inside a 3 px frame of the tier's flat colour; no face text, no glow, no animation. Its row's text names the tier (`market-and-shop.md` §3.6).
- Tiles keep their caption (count, listed line, price) **under** the card, outside the frame (`collection-overview.md` §6.2), so the card itself is identical in every place.

### 3.3 Art placeholder and failure

- Loading: the art box shows the mixer's placeholder, `repeating-linear-gradient(135deg, rgba(255,255,255,.04) 0 7px, rgba(255,255,255,.07) 7px 14px)` (token `--card-art-placeholder`), static.
- Failed or refused by the CSP: the same box with `No image` centred in `--color-card-ink-subtle`, 11 px.
- The `<img>` has `alt=""`: the card's accessible name already names the character (§8).

## 4. Face and ink

### 4.1 The face (night sky, every tier)

The face is dark with three small stars, the same for every tier:

```
--card-face:
  radial-gradient(circle at 20% 15%, rgba(255,255,255,.8) 0 1px, transparent 1.5px),
  radial-gradient(circle at 75% 22%, rgba(255,255,255,.6) 0 1px, transparent 1.5px),
  radial-gradient(circle at 55% 35%, rgba(255,255,255,.5) 0 1px, transparent 1.5px),
  linear-gradient(180deg, #1b1e36, #121320 65%);
```

The sky's stars are 1 px dots: they are texture, never near the size of the tier stars, and do not move.

### 4.2 Ink and contrast (WCAG AA)

Text sizes on the card are below 18.66 px bold and 24 px regular, so every text pair needs **4.5:1**. Ratios computed with the WCAG relative-luminance formula against the face's lightest point under each line: the face top `#1b1e36` (worst case for name and stars; the stars line itself sits on about `#191c32`), the face bottom `#121320` (series), and the rank chip over pure white art (its worst case).

| Text                        | Colour (token)                         | Background                                              | Ratio    | AA       |
| --------------------------- | -------------------------------------- | ------------------------------------------------------- | -------- | -------- |
| Name                        | `#eceaf3` (`--color-card-ink`)         | face top `#1b1e36`                                      | 13.71    | pass     |
| Series                      | `#bcb8c9` (`--color-card-ink-muted`)   | face bottom `#121320` (top: 8.43)                       | 9.51     | pass     |
| Rank                        | `#a6a3b6` (`--color-card-ink-subtle`)  | rank chip `rgba(18,19,32,.9)` over white art, `#2a2b36` | 5.70     | pass     |
| Rank                        | same                                   | rank chip over black art                                | 7.49     | pass     |
| `No image`                  | `#a6a3b6`                              | art placeholder over the face top, `#2b2e44`            | 5.41     | pass     |
| Stars, Common               | `#9a9da6`                              | face top                                                | 6.03     | pass     |
| Stars, Uncommon             | `#3cc7a9`                              | face top                                                | 7.73     | pass     |
| Stars, Rare                 | `#6f95ec`                              | face top                                                | 5.59     | pass     |
| Stars, Epic, owner's accent | `#e04563`                              | face top                                                | **4.05** | **fail** |
| Stars, Epic, text token     | `#e45b76` (`--color-rarity-epic-text`) | face top                                                | 4.71     | pass     |
| Stars, Legendary            | `#f5b84a`                              | face top                                                | 9.21     | pass     |
| Stars, Mythic               | `#b79ff0`                              | face top                                                | 7.18     | pass     |

**The one change to the owner's values**: the Epic accent `#e04563` reaches only 4.05:1 as text on the face (4.39:1 on `zinc-900`). Text uses `#e45b76`, the owner's ruby mixed 12 % toward white, which passes everywhere it is used (4.71 on the face top, 5.11 on `zinc-900`, 5.74 on `zinc-950`, 4.96 on a pressed chip over `zinc-950`). The frame, the glow and every non-text mark keep `#e04563`. Every other tier's text colour is its accent unchanged.

**The tier colours on the app's surfaces** (filter chips, per-tier totals, odds tables, `collection-overview.md` §6.3), text colour = `--color-rarity-<tier>-text`:

| Tier             | on `zinc-900` | on `zinc-950` | pressed chip (`/15` fill over `zinc-950`) |
| ---------------- | ------------- | ------------- | ----------------------------------------- |
| Common           | 6.54          | 7.34          | 6.07                                      |
| Uncommon         | 8.38          | 9.41          | 7.50                                      |
| Rare             | 6.06          | 6.81          | 5.69                                      |
| Epic (`#e45b76`) | 5.11          | 5.74          | 4.96                                      |
| Legendary        | 9.99          | 11.21         | 8.72                                      |
| Mythic           | 7.79          | 8.75          | 7.01                                      |

Filter chips sit on `zinc-950` only (a pressed Epic chip on `zinc-900` would be 4.26:1).

Non-text: the frames are decoration (WCAG 1.4.11 does not apply: no state or meaning rests on them alone); the focus ring is the app's violet ring with a 2 px offset, at 3:1 or more against `zinc-950`.

## 5. The six tiers and their frames

### 5.1 Tiers

| #   | Tier      | Stars  | Popularity band (owner)   | Share of a standard pack's cards (owner) |
| --- | --------- | ------ | ------------------------- | ---------------------------------------- |
| 1   | Common    | ✦      | the rest, 65–100 % (35 %) | 56 %                                     |
| 2   | Uncommon  | ✦✦     | 40–65 %                   | 24 %                                     |
| 3   | Rare      | ✦✦✦    | 20–40 %                   | 16 %                                     |
| 4   | Epic      | ✦✦✦✦   | 8–20 %                    | 3.4 %                                    |
| 5   | Legendary | ✦✦✦✦✦  | 2–8 %                     | 0.55 %                                   |
| 6   | Mythic    | ✦✦✦✦✦✦ | top 2 %                   | 0.05 %                                   |

Bands are by popularity rank within the snapshot ("Owner, 2026-10-29"; `collection-packs.md` §5.1.4). The shares are the owner's round 5 figures (`collection-packs.md` §5.4.1: the slot floors kept and 3 points moved from Uncommon to Rare, which supersedes round 4's 27 % and 13 %), exact for a standard pack. Enchanted packs, Radiant packs and the guarantee add to the upper tiers: over the long run of one account's free packs the shares are Common 55.98 %, Uncommon 23.99 %, Rare 14.38 %, Epic 4.77 %, Legendary 0.772 % and Mythic 0.113 % (`collection-packs.md` §5.4.6). The long-run figures go on no screen; the odds page shows a standard pack's figures and the special rules in words (§7.3). The UI shows every number from the server (§7.3), never from this table.

### 5.2 Frames (the owner's mix)

| Tier      | Mixer id | Frame background                                                                                                                         | Glow (`box-shadow`)                | Motion             | Mark colour |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------ | ----------- |
| Common    | `D-c`    | flat `#686b73`                                                                                                                           | none                               | none               | `#9a9da6`   |
| Uncommon  | `B3-u`   | flat `#2fb79c` (aurora teal)                                                                                                             | none                               | none               | `#3cc7a9`   |
| Rare      | `B3-r`   | flat `#2a4fa8` (dark blue)                                                                                                               | none                               | none               | `#6f95ec`   |
| Epic      | `C-e`    | faceted ruby: `conic-gradient(from 45deg, #8e1730, #e04563, #8e1730, #c22c4b, #8e1730)`                                                  | `0 0 24px rgba(224, 69, 99, .4)`   | glint (§5.3)       | `#e04563`   |
| Legendary | `C-l`    | faceted topaz: `conic-gradient(from 45deg, #a8641a, #f5b84a, #c27b22, #ffd57a, #a8641a)`                                                 | `0 0 30px rgba(245, 184, 74, .45)` | glint (§5.3)       | `#f5b84a`   |
| Mythic    | `D-m`    | shifting pearl: `linear-gradient(120deg, #b79ff0, #ece3ff, #8f6fe0, #d9cdfb, #a88ff0, #f3eeff, #b79ff0)` at `background-size: 300% 300%` | `0 0 34px rgba(170, 140, 240, .5)` | pearl drift (§5.3) | `#b79ff0`   |

The flat colour used for a thumbnail's frame (§3.2) is the flat background for Common to Rare and, for Epic to Mythic, the gradient's middle stop: `#c22c4b`, `#c27b22`, `#a88ff0`.

### 5.3 Animation

| Effect          | Tiers           | What moves                                                                                                                                                                                                               | Keyframes                                                                                      | Timing                                                                                        |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Glint**       | Epic, Legendary | a `::after` layer over the whole card (`inset: 0`, the card's radius, `pointer-events: none`) with `linear-gradient(105deg, transparent 42%, rgba(255,255,255,.5) 50%, transparent 56%)` at `background-size: 260% 100%` | `card-glint`: `0%, 60% { background-position: 130% 0 } 100% { background-position: -130% 0 }`  | `5.5s ease-in-out infinite`: the light rests off the card for 3.3 s, then crosses it in 2.2 s |
| **Pearl drift** | Mythic          | the frame's own background position                                                                                                                                                                                      | `card-pearl`: `0%, 100% { background-position: 0% 40% } 50% { background-position: 100% 60% }` | `7s ease-in-out infinite`                                                                     |

- **Not in step.** Several animated cards on one screen must not glint together. Each card sets a negative delay from its character id: `animation-delay: calc(var(--card-phase) * -1s)`, with `--card-phase` = `characterId mod 11` × 0.5 (0 to 5 s). Stable per character, so a card does not jump when the grid re-renders.
- **Glow** is static: a `box-shadow` that never animates. At the tile size it may spill into the 12 px grid gap; that is intended.
- **Where effects play** (owner's decision, §9): in the reveal and the card dialog always; never on the landing demo pack, whose card has the tier border and no glow, glint or drift (`navigation-and-landing.md` §3.7, owner's decision, §12 note); in the collection and market grids, the glow is always shown and the glint and drift play only while the card is hovered or focused.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no glint (the `::after` layer is not rendered) and no drift (the pearl rests at `0% 40%`). The frames and glows stay, as still images. The reveal's entry animation is the 1c web spec's and stops too.
- Nothing else on the card moves: no hover lift, scale, tilt or parallax (`docs/06-engineering-standards.md` §2 still applies to those).

### 5.4 Owner decision: glows and pearl on the frames

`docs/06-engineering-standards.md` §2 bans glowing borders as decoration and purple-to-pink effects, and §3 asks for motion that does not loop. **The owner overrides these for the card frames only** ("Owner, 2026-10-29", choosing `C-e`, `C-l` and `D-m` in the mixer): Epic, Legendary and Mythic frames glow, Epic and Legendary glint, and Mythic is a shifting purple pearl. The override is bounded:

- It covers the card frame and nothing else: no glow on buttons, panels, chips, text or the page.
- Every looping effect stops under reduced motion (§5.3).
- Rarity is never carried by the frame alone: the stars and, in text, the tier word carry it.
- The standards file is not edited by this spec; the manager records the exception there (or in an ADR) when the 1c web PR lands.

## 6. Markers on the card

### 6.1 Stars

- `✦` (U+2726 BLACK FOUR POINTED STAR, a text glyph, not an emoji) repeated by the tier's number (1 to 6), in `--color-rarity-<tier>-text`, `letter-spacing: 2px`, `line-height: 1`, `font-variant-emoji: text`, on their own line **under** the name.
- The glyphs are `aria-hidden="true"`; a visually hidden sibling reads the tier: `Rare, 3 stars` (§8).
- Elsewhere in the app (chips, totals, odds tables, dialog facts) the tier word carries the tier, and may be preceded by its stars in the same colour.

### 6.2 Rank line

- Shows the character's popularity rank in the current snapshot over the pool size: `#0012 / 2983` (the first real snapshot's pool after the franchise cap, `collection-packs.md` §5.1.10). The rank is zero-padded to the number of digits of the pool size; neither number has a thousands separator (it is an identifier, not an amount).
- Drawn in the **rank chip** at the art's bottom-left, 7 px in from both edges: `background: rgba(18,19,32,.9)` (`--color-card-chip`), radius 3 px, padding `1px 4px`, the app's mono stack, `tabular-nums`, `--color-card-ink-subtle`. The chip, not a scrim, keeps it legible over any art (§4.2).
- The rank is the character's **current** rank. A character not in the current snapshot has no rank: the chip is not drawn.
- Accessible text: `Popularity rank 12 of 2,983` (here the numbers are formatted as numbers).
- Data: `CharacterPublic.rank` over `SnapshotInfo.characterCount` (§12, R1). Not every answer that carries a character carries a `SnapshotInfo`: the collection reads the count from `CollectionResponse.snapshot`, the shop from `ShopResponse.snapshot`, and the pack reveal, whose `PackOpened` has none, from the last `GET /api/packs` answer's `odds.snapshot` (the pack page always holds one before it can open a pack). Wherever no count is held, the chip shows the rank alone, padded to four digits (`#0012`), and the accessible text is `Popularity rank 12`.

## 7. Packs, pity and the odds page

The owner's pack rules ("Owner, 2026-10-29"): slots 1 to 3 are Common or better, slot 4 Uncommon or better, slot 5 Rare or better; every 10th free pack is an **Enchanted** pack, whose slot 5 is Epic or better; about 1 pack in 2,500 is a **Radiant** pack, five cards of Epic or better including a Mythic; and a player's 300th free pack in a row without a Mythic contains one (**pity**). The rules are shown plainly and only where a player looks for them. **No countdown, no progress bar, no "next pack is Enchanted", no near-miss and no fanfare** (ADR 0004 §6). The one number shown on the pack page is the pity counter, which the owner chose (§7.4, §9); it is drawn with the least nudge possible.

### 7.1 On the pack page (`/packs`)

- The pack control is unchanged by these rules: it never says which kind the next pack will be, and nothing about pity is on or inside it. The pity counter is a separate line under it (§7.4).
- Under the control, a text button `Pack odds` opens the odds page (§7.3).
- **After an Enchanted pack**: the reveal's heading reads `Enchanted pack`, and one line under the pull summary says `Every 10th free pack is Enchanted: its fifth card is Epic or better.`
- **After a Radiant pack**: the heading reads `Radiant pack`, and the line says `About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.`
- **After a pity Mythic**: the line says `This Mythic came from the guarantee: a 300th free pack in a row without a Mythic always has one.`
- **After an Enchanted pack whose Mythic came from pity** (both rules fell on one pack, `collection-packs.md` §5.4.3): the heading reads `Enchanted pack`, and both lines show, the Enchanted line first.
- Which heading and lines show comes from `PackOpened.packKind` (`standard`, `enchanted`, `radiant`) and `PackOpened.pityMythic`; the UI never infers it from the cards.
- Otherwise the heading is the ordinary one from the 1c web spec. The special packs use the same reveal sequence, the same cards and the same timing; the frames already show what came. No extra animation, sound, colour or confetti.
- All numbers in these lines come from the server (§12, R3: `odds.enchanted.every`, `odds.radiant.chance` out of `odds.scale` shown as `1 pack in <scale ÷ chance>`, `odds.pity.packs`); the strings above show today's values. The word `free` follows `odds.pity.freePacksOnly` (§7.4).

### 7.2 Shop packs

The server fixes which rules apply to themed packs (`collection-packs.md` §5.4.7): **Radiant applies to every pack**, shop packs included; **Enchanted packs and the guarantee count free packs only**, so a shop pack is never Enchanted or pity-due, though a Mythic from one restarts the guarantee. `PublishedOdds.pity.freePacksOnly` is `true`. After a shop pack whose `packKind` is `radiant`, the reveal adds the Radiant line under the pull summary (its heading stays the shop's `<title> pack`, `market-and-shop.md` §3.3); it never shows the Enchanted or guarantee line. The shop's odds (`market-and-shop.md` §3.3) use the same words.

### 7.3 The odds page

A native `<dialog>` (the Manage account shell, `max-w-lg`) opened by `Pack odds`, with the heading `Pack odds` and four parts, every number from `GET /api/packs` (`PacksResponse.odds`, a `PublishedOdds`, §12, R3):

1. **Tiers**, a table: `Tier` (the stars and the word, in the tier's text colour), `Characters` (`tierSizes`), `Share of cards` (`share`, a standard pack's share per card, over `scale`), `At least one per pack` (`perPack`, a standard pack's, over `scale`). Under it, the line `Shares and chances are for a standard pack; the special packs below add to the rarer tiers.` Percentages in the format of `market-and-shop.md` §3.3: up to three significant digits, never rounded up, so 99.9704 % shows as `99.9%` and Mythic's share as `0.05%`.
2. **Slots**, from `slots[].floor`: `Cards 1 to 3: Common or better. Card 4: Uncommon or better. Card 5: Rare or better.`
3. **Special packs**: the Enchanted, Radiant and guarantee sentences of §7.1, then `Shop packs can be Radiant. They don't count toward Enchanted packs or the guarantee.` (from `pity.freePacksOnly`, §7.2).
4. **How tiers are set**, from `tierBands` over `bandScale`: `A character's tier comes from its popularity rank on AniList among the <N> characters of the current pool: Mythic is the top 2%, Legendary the next 6%, Epic the next 12%, Rare the next 20%, Uncommon the next 25%, Common the rest.` (`<N>` = `snapshot.characterCount`) and `Pool as of <D Mon YYYY>.` (`snapshot.takenAt`).

The page has no call to action: its only button is `Close`.

### 7.4 The pity counter (owner's decision)

The owner chose to show how close the guarantee is, on the pack page ("Owner, 2026-10-29", over this spec's recommendation to show it nowhere). It is drawn so that it informs and does not pull:

- **Wording**: plain fact, `Mythic guaranteed within <n> free packs.` (`within 1 free pack.` for one). `<n>` is the server's `packsUntilGuarantee`, 1 to 300: the free pack that many openings from now contains a Mythic at the latest (§12, R5). The server counts free packs only (`odds.pity.freePacksOnly` is `true`, `collection-packs.md` §5.4.7), so the copy says `free packs`; the word follows that flag, and without it the copy would read `packs` (`pack`).
- **Placement**: its own line under the pack control and its countdown, in the row with the `Pack odds` button (the counter left, the button right; stacked on a phone, counter first). Never on, inside or as part of the open-pack button, never in the button's accessible name or description, never next to a Karma price.
- **Look**: `text-xs text-zinc-400 tabular-nums`, the same as the other secondary lines on the page. No progress bar, ring or meter; no Mythic colour, star or icon; no animation or transition when the number changes; no emphasis as it gets small.
- **No other copy**: no "almost there", "only <n> to go", "soon", exclamation marks or anything that changes with the number. The sentence is the same at 300 and at 1.
- **Data**: shown only when the server sends the number (`PacksResponse.packsUntilGuarantee` and `PackOpened.packsUntilGuarantee`, R5); `null` (no snapshot) means the line is not rendered. The UI never counts packs itself; it shows the number from the last answer, a shop pack's `ShopReceipt.pack` included (unchanged, or 300 after its Mythic).

| State                                                               | User sees                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pack page loading (`GET /api/packs` not answered)                   | No counter line                                                                                                                                         |
| the server sends no number (`null`: no snapshot, cards unavailable) | No counter line                                                                                                                                         |
| number `n` ≥ 2                                                      | `Mythic guaranteed within <n> free packs.`                                                                                                              |
| number 1                                                            | `Mythic guaranteed within 1 free pack.`                                                                                                                 |
| opening in flight                                                   | The number from the last answer, unchanged                                                                                                              |
| after an opening                                                    | The number from `PackOpened`, replaced without transition                                                                                               |
| after a pity Mythic                                                 | The counter restarts at the server's new number (for example `within 300 free packs`); the reveal's line (§7.1) says the Mythic came from the guarantee |
| after any other Mythic                                              | The counter restarts at the server's new number; nothing else is said                                                                                   |
| stale (the server unreachable)                                      | The number last received, as the rest of the page                                                                                                       |

| Element      | Copy                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Pity counter | `Mythic guaranteed within <n> free packs.` / `Mythic guaranteed within 1 free pack.` (if `freePacksOnly` were false: `packs` / `pack`) |

**Accessibility**: a plain `<p>` in the pack section, after the pack control in DOM order. It is **not** a live region and not referenced by `aria-describedby`, so a screen reader reads it once, when the player reaches it, and is not told the new number after every pack. Contrast `zinc-400` on `zinc-950`: 7.76:1.

## 8. Accessibility

- The card is not itself a control. Where it opens something (a tile), the wrapping `<button>` is named as `collection-overview.md` §7 says, and the card's inner text is hidden from that name's computation only by being inside the button (the button's `aria-label` is the full sentence).
- Where the card stands alone (reveal, demo), it is an `<article aria-label="<name>, <Tier>, <series>">` with the stars' hidden text and the rank's accessible text inside.
- Bidi isolation (T1, as C9 does for logins; `collection-overview.md` §5.6): the name and the series each sit in their own `dir="auto"` element, and in the plain strings (the article's `aria-label`, the two `title`s) each is wrapped in U+2068 … U+2069.
- Stars: glyphs `aria-hidden`, text `<Tier>, <n> stars` (`1 star` for Common).
- Rank: `Popularity rank <rank> of <pool>`.
- Effects are decoration: no `aria-live`, nothing announced.
- Pity counter: a plain paragraph, read once, never announced (§7.4).
- Reduced motion: §5.3. Contrast: §4.2. Rarity is never colour alone: §6.1.

## 9. Decisions

Both questions of this spec's first version, answered by the owner on 2026-10-29:

| Question                                 | Decision ("Owner, 2026-10-29")                                                                                                                                             | Where |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Where the glint and the pearl drift play | Option A: always in the reveal and the card dialog; in the collection and market grids the glow always shows, and the glint and drift play only on hover or keyboard focus | §5.3  |
| Showing pity progress                    | Option C, the owner's choice over this spec's recommendation (A, not shown): a counter on the pack page, drawn with the least nudge possible                               | §7.4  |

No question is open.

## 10. Tokens

All in `web/src/index.css`, replacing the current rarity block. Colours in `@theme` (they become Tailwind utilities such as `text-rarity-rare-text`, `bg-card-face-top`); gradients and the face in `:root` custom properties, used by the `card-frame-<tier>` and `card-face` utilities (`@utility`); shadows and animations in `@theme`.

**Colours (`@theme`)**

| Token                                                       | Value                                                      | Use                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `--color-rarity-common`                                     | `#9a9da6`                                                  | mark: stars, chip borders and fills, odds table |
| `--color-rarity-uncommon`                                   | `#3cc7a9`                                                  | mark                                            |
| `--color-rarity-rare`                                       | `#6f95ec`                                                  | mark                                            |
| `--color-rarity-epic`                                       | `#e04563`                                                  | mark (never as text)                            |
| `--color-rarity-legendary`                                  | `#f5b84a`                                                  | mark                                            |
| `--color-rarity-mythic`                                     | `#b79ff0`                                                  | mark                                            |
| `--color-rarity-common-text` … `--color-rarity-mythic-text` | the mark value, except `--color-rarity-epic-text: #e45b76` | every text in a tier colour (stars, tier words) |
| `--color-card-face-top`                                     | `#1b1e36`                                                  | the face's gradient start                       |
| `--color-card-face-bottom`                                  | `#121320`                                                  | the face's gradient end                         |
| `--color-card-ink`                                          | `#eceaf3`                                                  | name                                            |
| `--color-card-ink-muted`                                    | `#bcb8c9`                                                  | series                                          |
| `--color-card-ink-subtle`                                   | `#a6a3b6`                                                  | rank, `No image`                                |
| `--color-card-chip`                                         | `rgb(18 19 32 / 0.9)`                                      | the rank chip                                   |
| `--color-card-glint`                                        | `rgb(255 255 255 / 0.5)`                                   | the glint's light                               |

**Shadows (`@theme`)**: `--shadow-glow-epic: 0 0 24px rgb(224 69 99 / 0.4)`, `--shadow-glow-legendary: 0 0 30px rgb(245 184 74 / 0.45)`, `--shadow-glow-mythic: 0 0 34px rgb(170 140 240 / 0.5)`.

**Animations (`@theme`, with their `@keyframes` from §5.3)**: `--animate-card-glint: card-glint 5.5s ease-in-out infinite`, `--animate-card-pearl: card-pearl 7s ease-in-out infinite`.

**Frames, face and placeholder (`:root`)**

| Token                                             | Value                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `--card-frame-common`                             | `#686b73`                                                                                |
| `--card-frame-uncommon`                           | `#2fb79c`                                                                                |
| `--card-frame-rare`                               | `#2a4fa8`                                                                                |
| `--card-frame-epic`                               | `conic-gradient(from 45deg, #8e1730, #e04563, #8e1730, #c22c4b, #8e1730)`                |
| `--card-frame-legendary`                          | `conic-gradient(from 45deg, #a8641a, #f5b84a, #c27b22, #ffd57a, #a8641a)`                |
| `--card-frame-mythic`                             | `linear-gradient(120deg, #b79ff0, #ece3ff, #8f6fe0, #d9cdfb, #a88ff0, #f3eeff, #b79ff0)` |
| `--card-frame-flat-epic`, `-legendary`, `-mythic` | `#c22c4b`, `#c27b22`, `#a88ff0` (thumbnails)                                             |
| `--card-face`                                     | §4.1                                                                                     |
| `--card-glint-image`                              | `linear-gradient(105deg, transparent 42%, var(--color-card-glint) 50%, transparent 56%)` |
| `--card-art-placeholder`                          | §3.3                                                                                     |

**Removed**: the earlier `--color-rarity-*` values (`#a1a1aa`, `#38bdf8`, `#fbbf24`, and the planned `#34d399` and `#fb7185`), the `legendary-pulse` keyframes and the `.glow-legendary` class.

## 11. Where it applies

| Place                                                  | Spec                                     | What it takes from here                                                                                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1c web PR: pack reveal**                             | `collection-packs.md` §8 and its UI spec | the card at reveal size (§3.2), frames and effects (§5), stars and rank (§6), the special-pack headings and lines (§7.1); replaces `CharacterCard`'s frame, glow, `RarityBadge` overlay and gradient scrim; all tokens of §10 |
| **1c web PR: odds**                                    | same                                     | the `Pack odds` button and dialog (§7.3), replacing the one-line odds text                                                                                                                                                    |
| **Collection overview: tiles**                         | `collection-overview.md` §6.2            | the card at tile size with its caption under it; effects per §5.3                                                                                                                                                             |
| **Collection overview: dialog**                        | `collection-overview.md` §5.4            | the card at dialog size in place of the art                                                                                                                                                                                   |
| **Collection overview: filter chips, per-tier totals** | `collection-overview.md` §6.3            | the six tier text colours (§4.2), chips on `zinc-950` only                                                                                                                                                                    |
| **Market and shop**                                    | `market-and-shop.md`                     | the tile and dialog card, the thumbnail (§3.2), the shop's odds lines in the odds page's words                                                                                                                                |
| **Landing page: demo pack**                            | `navigation-and-landing.md` §3.7         | the reveal-size card with the tier border and no effect (no glow, glint or pearl drift), as that spec's §3.7 item 1.4 and §6.2 say (§12, note); its art and names are whatever that spec shows                                |

## 12. What this spec uses from the server (as shipped in #28)

`collection-packs.md` shipped six tiers in #28 (`shared/src/api.ts`, `shared/src/rarity.ts`). Each need of this spec's first version, with the shipped field that meets it and where the shipped contract differs from what was asked:

| #   | Need                                                                                             | Shipped contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **Rank on the card.** The favourites rank in the current snapshot and the pool size it is out of | `CharacterPublic.rank: integer ≥ 1 \| null` (null when the character is not in the current snapshot; the favourites count itself is never sent); `SnapshotInfo.characterCount` on `CollectionResponse.snapshot` and on `PublishedOdds.snapshot` (so on `GET /api/packs`)                                                                                                                                                                                                                                                                                                                                                                              | Met, with one difference: the count is **not** on every answer that carries a character. `PackOpened` has no `SnapshotInfo`, so the reveal takes the count from the last `GET /api/packs` answer (§6.2). `economy.md`'s `ListingsPage` has none either (asked of `economy.md`) |
| R2  | **Six tiers.**                                                                                   | `Rarity` and `RARITIES` = `common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`, in rank order; `PerRarity` with six keys; `RARITY_LABEL` with `Uncommon`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Met                                                                                                                                                                                                                                                                            |
| R3  | **Pack rules and their publication.**                                                            | `PublishedOdds`: `scale` (1 000 000); `slots[]`, a standard pack's five tables in slot order, each with its `floor`; `share` and `perPack`, a standard pack's, in parts per million; `enchanted` { `every` 10, `slot` 4 (the fifth card), `floor` `epic`, `odds` }; `radiant` { `chance` 400, `odds` for slots 0 to 3, `lastSlot` `mythic` }; `pity` { `packs` 300, `freePacksOnly` true }; `bandScale` 10 000 and `tierBands`; `tierSizes`; `snapshot`. `PackOpened.packKind` (`standard`, `enchanted`, `radiant`) and `PackOpened.pityMythic`. Shop packs: Radiant applies, Enchanted and pity count free packs only (`collection-packs.md` §5.4.7) | Met. The names differ from this spec's first version: the pack's kind is `packKind` (`kind` already tells cards from Relics), the pity flag is `pityMythic`, and the share is `share`                                                                                          |
| R5  | **Pity counter.**                                                                                | `PacksResponse.packsUntilGuarantee` and `PackOpened.packsUntilGuarantee`: `integer 1..300 \| null`, null exactly when there is no snapshot; the free pack that many openings from now holds a Mythic at the latest; on a replay, the current number. Shop packs do not count, and a Mythic from any source restarts it                                                                                                                                                                                                                                                                                                                                | Met                                                                                                                                                                                                                                                                            |
| R4  | **Economy numbers for six tiers.**                                                               | Not shipped: `economy.md` (landed in 0562e10) says its per-tier values, bounds, pack price and model are still five-tier and must be re-derived before item 2 is built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Open, the manager's; `collection-overview.md` §3.9 keeps its placeholders                                                                                                                                                                                                      |

**Note: the landing demo card.** §9's first decision put every effect on the landing demo pack; `navigation-and-landing.md` §3.7 item 1.4 and §6.2 (merged in #30) draw the demo card with "no glow" and no different treatment for a Legendary or Mythic. **Decided** ("Owner, 2026-10-29, after #32": follow the navigation spec): the demo card has no glow, glint or drift, and §5.3 and §9 no longer list the demo pack among the places effects play. Its `perSlot` and five-tier wording were brought to the shipped contract in #32.
