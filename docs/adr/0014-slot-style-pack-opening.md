# 0014 — Slot-style pack opening

2026-10-31 · accepted · amends ADR 0004 §6 (how it applies to pack openings); ADR 0004 otherwise stands

## Context

The owner found the site's look and feel flat next to a reference game and asked for a redesign. The reference's pack opening is a ceremony: the player holds to break the pack open, the cards wait face down and are turned one at a time, a card back glows in its tier's colour before it turns, and an Epic or rarer pull gets a full-screen moment. Our specs ruled all of this out. `collection-packs.md` §8, `card-and-rarity.md` §5.3 and §7.1, `packs-page.md` §3.4 and `navigation-and-landing.md` read ADR 0004 §6 ("No near-miss manipulation") as "no suspense effects at all": every pack enters the same way, and no tier gets more motion, sound or delay than its frame.

The manager offered three options: keep the rule; a ceremony without hints before the turn; or the reference's full slot feel, with the tier glow before the turn. The owner chose the third ("Go with C, I want the slot feel. This will go good with the blackjack and actual slots that we add later", 2026-10-31).

## Decision

1. **The pack opening may build suspense.** Hold to open, cards face down and turned one at a time, a tier-coloured glow before a card turns, sound, and more motion and a full-screen moment for higher tiers are allowed. This applies to every pack: the timer pack, shop packs and the public demo.
2. **What ADR 0004 §6 still forbids, read narrowly:** near-miss manipulation, meaning a show that suggests the player almost got something they did not.
   - Every tell is true. A glow, sound or pause before a turn shows the card's real tier and never a higher one.
   - No tease that turns out lower. No fake "almost Mythic". No slowdown that only happens on a miss.
   - The server decides the whole pack before anything animates (C1, C20). The ceremony only reveals the result and never changes it.
3. **The player can always get out.**
   - `Reveal all` and a skip are on screen throughout the ceremony.
   - `prefers-reduced-motion` gets a short version.
   - Sound is off until the player turns it on.
   - The odds stay one press away, as today.
4. **No streak or timer nags still holds** (ADR 0004 §6). Spending Karma on a shop pack keeps its confirmation, with no "don't warn me again".

## Consequences

- `ui-designer` writes the visual identity and the opening ceremony (`docs/design/visual-identity.md`, `docs/design/pack-opening.md`). They amend the four specs above where they forbid suspense, and cite this ADR.
- The ceremony is a client-side presentation of a server result. The security officer reviews its build PR for C1/C20: the result is never shown early in the DOM, storage or address bar beyond what the server already sent; no outcome is computed in the client; and the tells are truthful.
- The blackjack and slots specs (roadmap items 5 and 6) may use the same rules.
