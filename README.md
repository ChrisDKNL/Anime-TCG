# Anime TCG

A solo, non-commercial anime card-collection game. Open booster packs of five
characters pulled from the free [AniList GraphQL API](https://docs.anilist.co/),
each rolled for a rarity tier, and build a collection that persists in your browser.

Stack: Vite 8 · React 19 · TypeScript · Tailwind CSS 4. No backend, no auth, no API keys.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve dist/ locally
```

## File structure

```
index.html                     Vite entry, <html class="dark">
vite.config.ts                 React + Tailwind v4 plugins
src/
  main.tsx                     React root
  index.css                    Tailwind import, rarity colour tokens, reveal/glow keyframes
  types.ts                     Rarity, Character (from API), Card (owned instance)
  lib/
    anilist.ts                 GraphQL query, fetch + normalise, 24h localStorage cache
    rarity.ts                  Weighting maths: base odds, popularity tilt, roll
    pack.ts                    openPack(): sample 5 distinct characters, assign rarity
  hooks/
    useCharacterPool.ts        Loads the pool once; loading / ready / error + reload()
    useInventory.ts            The inventory array, persisted, with derived stats
  components/
    BoosterPack.tsx            The "Open Booster Pack" button + odds line
    CharacterCard.tsx          Image, name, anime origin, glowing rarity frame
    RarityBadge.tsx            Small tier pill
    Inventory.tsx              Collection grid, grouped duplicates, rarity filter
  App.tsx                      Wires it together: tabs, pack reveal, NEW badges
```

## How it works

### 1. API integration (`src/lib/anilist.ts`)

One query, paginated:

```graphql
query CharacterPool($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    }
    characters(sort: FAVOURITES_DESC) {
      id
      favourites
      name {
        full
      }
      image {
        large
      }
      media(perPage: 1, sort: POPULARITY_DESC, type: ANIME) {
        nodes {
          title {
            english
            native
            romaji
          }
        }
      }
    }
  }
}
```

- `sort: FAVOURITES_DESC` gives "popular characters"; `favourites` is the popularity score used by the rarity maths.
- `media(perPage: 1, sort: POPULARITY_DESC)` returns each character's single most popular anime, so every card has one clean origin label. `romaji` is a fallback for titles with no English name.
- Two pages of 50 (AniList's max `perPage`) = a 100-character pool. The result is cached in `localStorage` for 24 hours because AniList rate-limits to 90 requests/minute and is frequently degraded to 30 (see https://docs.anilist.co/guide/rate-limiting). "Retry" in the error banner bypasses the cache.

### 2. Pack opening (`src/lib/pack.ts`, `src/App.tsx`)

`openPack(pool)` does a partial Fisher–Yates shuffle to pick 5 _distinct_ characters, then calls `assignRarity` on each and stamps a `uid` and `pulledAt`. The button handler in `App.tsx`:

1. snapshots which character ids were already owned (for "NEW" badges),
2. clears `lastPack` so the reveal animation re-triggers,
3. after a 350 ms "ripping the pack" delay, sets `lastPack` and appends the cards to the inventory.

### 3. Rarity logic (`src/lib/rarity.ts`)

Base odds are the headline numbers: **Common 70 % · Rare 25 % · Legendary 5 %**.
On top of that, popularity tilts the odds slightly:

```
p         = popularityScore(character)          // 0..1, log-scaled favourites rank in pool
legendary = 0.05 + 0.10 · p · POPULARITY_INFLUENCE
rare      = 0.25 + 0.10 · p · POPULARITY_INFLUENCE
common    = 1 − legendary − rare
```

With `POPULARITY_INFLUENCE = 0.6`, the most popular character in the pool rolls
~11 % Legendary / ~31 % Rare; the least popular stays at exactly 5 % / 25 %.
Set the constant to `0` for a pure random roll with identical odds for everyone.

`popularityScore` uses `log1p(favourites)` because favourites are heavy-tailed
(the #1 character has ~10× the favourites of #100); a linear scale would give
every character outside the top five a score of ~0.

`rollRarity(weights, roll)` takes the random number as a parameter so it is
trivially unit-testable with a seeded value.

### 4. Inventory state (`src/hooks/useInventory.ts`)

The inventory is a **flat, append-only `Card[]`**:

```ts
const [cards, setCards] = useState<Card[]>(loadInventory); // hydrated from localStorage

const addCards = useCallback((newCards: Card[]) => {
  setCards((prev) => [...prev, ...newCards]); // functional update
}, []);
```

Why this shape:

- **Every pull is its own entry** with a unique `uid`. Duplicates are real duplicates, not a counter. That keeps the write path a single concat and means nothing can get out of sync.
- **Functional update** (`prev => [...]`) so two rapid pack-opens never overwrite each other with a stale closure.
- **Everything else is derived** with `useMemo`: total count, unique characters, counts per rarity, and (in `Inventory.tsx`) grouping by `characterId:rarity` so three Common pulls of the same character show once with "×3" while a Legendary pull of that character is its own card.
- A `useEffect` on `cards` writes the array to `localStorage` on every change, wrapped in `try/catch` so private-mode or quota errors degrade to in-memory only.
- `ownedBefore(timestamp)` returns the set of character ids owned before a pack was opened; `App.tsx` uses it to badge first-time pulls as **NEW**.

If this ever grew (trading, decks, thousands of cards), the natural next step is a `useReducer` with `ADD_CARDS` / `CLEAR` actions and an indexed `Map<characterId, Card[]>`. For a solo game a plain array is simpler and fast enough.

### UI notes

- Dark mode only (`color-scheme: dark`, zinc palette).
- Rarity frames are a `Record<Rarity, string>` of full Tailwind class strings. Tailwind v4 only emits classes it can see at build time, so the classes are never templated.
- Legendary cards get a pulsing amber glow (`glow-legendary` keyframes); Rare is a static sky-blue glow; Common a faint slate border. Animations respect `prefers-reduced-motion`.
- Grid: 2 columns on phones, 3 on small screens, 5 on large (pack view); up to 6 on the collection view.

## Attribution

Character images and titles belong to their respective rights holders and are
served by the AniList API under its [terms](https://anilist.co/terms). This
project is non-commercial and for personal use.
