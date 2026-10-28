# Local profiles (invite code)

Roadmap item 1 · implements [ADR 0003](../adr/0003-accounts-local-first.md) Phase 1 · leaves room for [ADR 0004](../adr/0004-economy-ground-rules.md) · written 2026-10-28

## 1. Goal

The owner (and anyone they hand the URL and an invite code to) can keep several separate card collections on one device, each under a named **profile**, and always see whose collection is on screen. Profiles live in `localStorage`, have no password, and are created only with an invite code that is a client-side placeholder for the real gate a backend will add later (ADR 0003 §2). The existing single collection must land in the first profile with zero data loss. The one piece that has to be built properly is the `StorageAdapter` boundary (`src/lib/storage/`): hooks and components never touch `localStorage` directly, so Phase 2 can swap the implementation without touching the UI.

## 2. Out of scope

- Third-party sign-in, sync, 2FA, importing a local profile into a cloud account (ADR 0003 Phase 2, roadmap 8). This spec must not block it, and does not design it.
- Trade between profiles (roadmap 7).
- The Profile page: avatar from a card, stats, showcase, balance, next-pack timer (roadmap 4). The initial-letter avatar here is a placeholder that item 4 replaces.
- Currency balance, pack timer, sell/recycle (roadmap 2). The data model leaves named slots for them (see §3.7); nothing is shown.
- Merging two collections on import. Import always creates a new profile.
- Per-profile settings of any kind (there are none yet).
- Any security claim. Names, codes and collections are editable in DevTools; the copy never says "secure", "verified", "protected" or "private".
- Concurrent edits to the _same_ profile from two tabs. This is a pre-existing limitation of the write-whole-array model and is unchanged; only the _active profile pointer_ is kept consistent across tabs (§4.7).
- Passwords, PINs, profile locking, profile avatars, profile colours.

## 3. Flow

### 3.1 Boot (every launch)

1. The app reads the profile index through the adapter. Until that resolves, nothing game-related renders (no flash of an empty collection). `localStorage` is synchronous so this is normally instant; the loading state in §4.1 exists for a future async adapter.
2. Branch on what is found:
   - **Profile index exists** → go to 3.6 (normal app) with the stored active profile. The legacy key, if it still exists, is ignored and left alone.
   - **No profile index, legacy collection `anime-tcg:inventory:v1` holds one or more cards** → 3.2 (migration).
   - **No profile index, legacy key missing, empty (`[]`) or unparseable** → 3.3 (first launch, create). An unparseable legacy value is left untouched (its bytes are not ours to lose); an empty array is removed.
   - **Storage unavailable** (reading throws) → 3.6 in memory with the storage-blocked banner (§4.1). No migration is attempted.

### 3.2 Migration of the existing collection (first launch with legacy data)

Automatic; no invite code; no user action can abort it half-way.

1. Create profile `Player 1` with the legacy cards as its inventory, through the adapter, in this order: write the profile inventory, write the profile index with `Player 1` active, read both back and compare counts.
2. Only if the read-back matches, remove `anime-tcg:inventory:v1`. If any write or read-back fails, nothing is removed and the app shows the migration-error state (§4.2), which offers an export of the legacy collection as the escape hatch.
3. On success the app renders normally (Booster tab) and opens the one-time **welcome dialog** (§4.2) offering to rename `Player 1`. Dismissing it keeps the name. The dialog is not shown again; rename stays available in Manage profiles.

The character-pool cache `anime-tcg:character-pool:v1` is device-global and is not touched.

### 3.3 First launch, no collection (create the first profile)

1. The header renders (title and subtitle only; no view tabs, no profile button).
2. The main area shows the **create-profile screen** (§4.3): name, invite code, `Create profile`, and a secondary `Import a profile file` link that opens the import flow (3.5, step 4 onwards) without a code.
3. On success the app renders normally on the Booster tab, with the new profile active.

### 3.4 Create another profile (profiles exist)

1. Switcher menu → `New profile…` opens the **create-profile dialog** (§4.3, same form, plus `Cancel`).
2. Validation on submit, not on keystroke. Errors are inline (§8).
3. On success: the dialog closes, the new profile becomes active, the app shows the Booster tab (a new profile is empty, so the pack is the only useful thing), focus returns to the profile button, the live region announces it.

If the device already holds the maximum of **10 profiles** (my decision: keeps the switcher readable and stays well inside the `localStorage` quota), the menu item is disabled with the reason as its tooltip and the dialog cannot be opened.

### 3.5 Switch, manage, export, import

1. The **profile button** in the header opens the **switcher menu** (§4.4): one radio item per profile (name, card count, check on the active one), then `New profile…` and `Manage profiles…`.
2. Choosing a profile switches immediately; there is no confirmation because switching loses nothing. The current view tab is kept; the "last pack" reveal grid is cleared (it belonged to the previous profile). The switcher is disabled while a pack is mid-open (`opening === true`).
3. `Manage profiles…` opens the **Manage profiles dialog** (§4.5): a list with per-row `Rename`, `Export`, `Delete`, and footer actions `New profile` and `Import from file`.
4. **Export** downloads one JSON file immediately (no dialog): `anime-tcg-<name-slug>-<YYYY-MM-DD>.json`, format in §3.7.
5. **Import**: file picker (`.json`) → parse and validate → **import preview** (name field prefilled from the file and editable, card count, rarity breakdown, export date) → `Import` creates a new profile, switches to it, closes the dialog. A malformed file shows one specific error and writes nothing (§4.6).
6. **Rename** is inline in the row (text field, `Save`, `Cancel`); same rules as create (duplicate check excludes the profile itself).
7. **Delete** replaces the dialog body with a confirmation panel that states the card count and offers `Export first`. After deleting the active profile the app switches to the most recently used remaining profile; after deleting the last profile the dialog closes and the create-profile screen (3.3) appears.

### 3.6 Normal app

Identical to today plus: the profile button in the header, `document.title` = `<name> · Anime TCG`, the Inventory `Reset` confirm names the profile (§8). The Collection tab keeps its `Collection (N)` label; N is the active profile's count.

### 3.7 Data ownership and what the adapter must expose

**Per-profile vs device-global** (the question every later feature will ask):

| Data                                          | Scope         | Key (contract, also used by e2e seeding)       | Notes                                                                       |
| --------------------------------------------- | ------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| Profile index: list + active profile id       | device-global | `anime-tcg:profiles:v1`                        | `{ version: 1, activeId, profiles: [{ id, name, createdAt, lastUsedAt }] }` |
| Collection (cards)                            | per-profile   | `anime-tcg:profile:<id>:inventory:v1`          | Same `Card[]` shape as today                                                |
| Currency balance, unclaimed packs, pack timer | per-profile   | `anime-tcg:profile:<id>:economy:v1` (reserved) | Roadmap 2 defines the contents; this PR must not create it                  |
| Character-pool cache                          | device-global | `anime-tcg:character-pool:v1`                  | Unchanged; shared by all profiles, never migrated or deleted                |
| Invite codes                                  | bundle        | `src/lib/invites.ts`                           | Not storage; a plain exported list                                          |
| Legacy collection                             | device-global | `anime-tcg:inventory:v1`                       | Read once by migration, then removed (only on verified success)             |

Profile `id` is a random UUID (never the name), so rename is free and keys are stable. Deleting a profile deletes every `anime-tcg:profile:<id>:*` key.

**Adapter surface, from the UX point of view** (names are suggestions; behaviour is the contract):

- `listProfiles()` → the index in creation order; `getActiveId()`.
- `createProfile(name)` → new profile; the adapter enforces nothing about invite codes (that check is UI/`src/lib/invites.ts`, so Phase 2 can replace it with a server call without touching the adapter).
- `setActive(id)` (also bumps `lastUsedAt`), `renameProfile(id, name)`, `deleteProfile(id)`.
- `getInventory(id)`, `setInventory(id, cards)`.
- `exportProfile(id)` → JSON string; `importProfile(json, nameOverride?)` → new profile, or a typed error naming which of the §4.6 reasons failed. Import validates before writing; a failed import writes nothing.
- `migrateLegacy()` → `{ migrated: false } | { migrated: true, profileId, cardCount } | { error }`; idempotent (a second call is a no-op once the index exists).
- `subscribe(listener)` → fires when another tab changes the index (`storage` event). Needed for §4.7.
- **Every write reports failure** (quota, blocked storage) instead of swallowing it as `useInventory` does today. The UI turns that into the save-failure banner (§4.7). An adapter that cannot read at all reports `unavailable` once at boot.

**Export file format** (version 1):

```json
{
  "format": "anime-tcg-profile",
  "version": 1,
  "exportedAt": 1761609600000,
  "profile": { "name": "Chris", "createdAt": 1761609600000, "cards": [/* Card[] */] }
}
```

Import accepts `version <= 1`, ignores unknown extra fields inside `profile` (so a later export with `economy` still imports here, minus that part, and the preview says so), and rejects `version > 1`. Roadmap 2 bumps the version when it adds economy fields.

## 4. States

### 4.1 Boot

| State               | User sees                                                                                                                                                                                                                                   | User can do                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| loading             | Header; main area shows `Loading your profiles…` (`text-sm text-zinc-500`, `aria-live="polite"`) only if boot takes longer than 300 ms, otherwise nothing                                                                                   | Wait                                 |
| storage unavailable | App renders normally in memory. Banner above the main area, `role="alert"`, same red style as the AniList error banner, copy §8 "storage-blocked". The profile button and all flows work as normal for the tab's lifetime; nothing persists | Everything, knowing nothing persists |
| ready               | Normal app (3.6)                                                                                                                                                                                                                            | Everything                           |

### 4.2 Migration

| State                       | User sees                                                                                                                                                                                                                    | User can do                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| not needed                  | Nothing. Index exists or there is nothing to migrate                                                                                                                                                                         | —                                                                                                      |
| migrating                   | Same as boot loading; in practice sub-frame                                                                                                                                                                                  | Wait                                                                                                   |
| success                     | Normal app on the Booster tab with `Player 1` active, Collection tab shows `Collection (N)` with the old N, and the **welcome dialog** (modal): heading, body naming N, name field prefilled `Player 1`, `Save`, `Skip`      | Rename now or skip. Either closes the dialog; data was already safe before it opened                   |
| success, empty name on Save | Inline error under the field; dialog stays                                                                                                                                                                                   | Fix the name or `Skip`                                                                                 |
| error                       | Full-main-area panel (same card style as the create screen): heading, body with the reason, `Try again` (primary), `Export my collection` (secondary; downloads the legacy array in the §3.7 envelope under name `Player 1`) | Retry, or export. The legacy key is untouched; no profile index exists yet, so the next launch retries |

### 4.3 Create profile (screen on first launch; dialog otherwise)

| State                 | User sees                                                                                                                                                                                          | User can do                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| idle                  | Heading, one-line intro, `Name` field (autofocused), `Invite code` field with hint below, primary `Create profile`. Screen variant adds `Import a profile file` link; dialog variant adds `Cancel` | Type, submit, (dialog) cancel/Escape |
| submitting            | Button text `Creating…`, button and fields disabled. Sub-frame in practice                                                                                                                         | Wait                                 |
| error: empty name     | `Name` gets `aria-invalid`, red border, message below (§8). Focus moves to the field                                                                                                               | Fix and resubmit                     |
| error: name too long  | Same treatment, message §8. Limit is 24 characters after trimming                                                                                                                                  | Fix and resubmit                     |
| error: duplicate name | Same treatment, message names the clash. Comparison is case-insensitive on the trimmed value                                                                                                       | Fix and resubmit                     |
| error: empty code     | `Invite code` gets the invalid treatment, message §8                                                                                                                                               | Fix and resubmit                     |
| error: invalid code   | Same, message §8. No attempt counter, no lockout, no delay (it is not security and must not pretend to be)                                                                                         | Fix and resubmit                     |
| error: both invalid   | Both fields marked; focus goes to `Name` (first invalid in DOM order)                                                                                                                              | Fix and resubmit                     |
| error: at profile cap | Only reachable by racing another tab; dialog body is replaced by the cap message (§8) and a single `Close` button                                                                                  | Close                                |
| error: save failed    | Form stays filled; banner inside the form (`role="alert"`), copy §8 "save-failed-create"                                                                                                           | Retry; nothing was written           |
| success               | Dialog closes / screen is replaced by the app on the Booster tab, new profile active, header button shows it, live region announces                                                                | Open a pack                          |

Invite-code input rules: trimmed, compared case-insensitively against `INVITE_CODES` in `src/lib/invites.ts`; codes are reusable (a client cannot consume them). Name rules: trimmed; 1–24 characters; any characters allowed; internal whitespace kept as typed.

### 4.4 Switcher menu

| State             | User sees                                                                                                                                                                             | User can do                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| closed            | Profile button: avatar circle with the first character of the name, the name, card count (hidden on phone), chevron                                                                   | Open                                                  |
| open              | Menu anchored below the button, right-aligned: one row per profile in creation order (avatar, name, `N cards`, check mark on the active), divider, `New profile…`, `Manage profiles…` | Pick a profile, pick an action, Escape, click outside |
| open, one profile | Same; the single profile row is still shown and checked, so the pattern is learnable before a second profile exists                                                                   | Same                                                  |
| open, at cap      | `New profile…` disabled, `title` = cap message                                                                                                                                        | Everything else                                       |
| disabled          | Button `disabled` while a pack is opening                                                                                                                                             | Wait ~350 ms                                          |
| switched          | Menu closes, focus back on the button, button shows the new name and count, Collection tab count updates, reveal grid clears, `document.title` updates, live region announces         | Continue                                              |

### 4.5 Manage profiles dialog

| State          | User sees                                                                                                                                                                                                                            | User can do                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| list           | Modal titled `Profiles`, close button, rows (avatar, name, `Active` pill on the active one, `N cards`, `Created <date>`; actions `Rename`, `Export`, `Delete`), footer `New profile`, `Import from file`, counter `N of 10 profiles` | Any action, close, Escape                                         |
| list, at cap   | Footer buttons `New profile` and `Import from file` disabled, counter reads `10 of 10 profiles`, helper line with the cap copy                                                                                                       | Rename/Export/Delete                                              |
| rename editing | The row's name becomes a text field prefilled with the name, `Save` and `Cancel` replace the row actions. Enter saves, Escape cancels (and does **not** close the dialog)                                                            | Save, cancel                                                      |
| rename error   | Same inline error treatment as create (empty / too long / duplicate)                                                                                                                                                                 | Fix, cancel                                                       |
| rename saved   | Row shows the new name; header button updates if it was the active profile; live region announces                                                                                                                                    | Continue                                                          |
| export done    | File download starts; the row's `Export` button is unchanged (no spinner, download is synchronous); live region announces                                                                                                            | Continue                                                          |
| export failed  | Only possible if serialisation throws; inline error under the row, copy §8                                                                                                                                                           | Retry                                                             |
| delete confirm | Dialog body replaced by: heading `Delete <name>?`, body naming the card count and "no undo", note if it is the only profile, buttons `Export first`, `Delete <name>` (danger), `Cancel`                                              | Export (stays on the panel), delete, cancel/Escape (back to list) |
| delete done    | Back to the list without the row; if the active profile was deleted, the header button shows the new active one; if the last one, the dialog closes and the create screen appears; live region announces                             | Continue                                                          |
| delete failed  | Stays on the confirm panel with an inline error (§8 "save-failed-generic"). Nothing partially deleted: the adapter deletes the inventory key only after updating the index                                                           | Retry, cancel                                                     |

### 4.6 Import (from the Manage dialog or the first-launch screen)

| State                     | User sees                                                                                                                                                                                                                                                                                                                                | User can do                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| picking                   | Native file picker (`accept=".json,application/json"`)                                                                                                                                                                                                                                                                                   | Pick, cancel (no UI change on cancel) |
| reading                   | Button text `Reading file…` on the trigger, disabled; for files under a few MB this is sub-frame                                                                                                                                                                                                                                         | Wait                                  |
| error: not a profile file | Dialog body shows an error panel (`role="alert"`): heading, reason (§8), `Choose another file`, `Back`                                                                                                                                                                                                                                   | Pick again, back to the list/screen   |
| error: newer version      | Same panel, §8 copy                                                                                                                                                                                                                                                                                                                      | Same                                  |
| error: damaged cards      | Same panel, §8 copy naming how many cards failed validation. The whole file is rejected; no partial import                                                                                                                                                                                                                               | Same                                  |
| error: at cap             | Same panel, cap copy                                                                                                                                                                                                                                                                                                                     | Back                                  |
| preview                   | Heading `Import profile`, `Name` field prefilled with the file's name (editable, same validation), summary line `N cards · L Legendary · R Rare · C Common` using the Inventory header pill style, `Exported <date>`; if the file carried fields this version ignores, a one-line note (§8 "import-partial"); buttons `Import`, `Cancel` | Edit name, import, cancel             |
| preview, duplicate name   | Inline error on the name field                                                                                                                                                                                                                                                                                                           | Fix                                   |
| importing                 | `Import` reads `Importing…`, disabled                                                                                                                                                                                                                                                                                                    | Wait                                  |
| error: save failed        | Preview stays, banner with §8 "save-failed-create"                                                                                                                                                                                                                                                                                       | Retry, cancel                         |
| success                   | Dialog/screen closes, imported profile is active, current tab kept (first-launch: Booster), live region announces                                                                                                                                                                                                                        | Continue                              |

Card validation for import: each entry must have string `uid`, number `characterId`, string `name`, string `imageUrl`, `rarity` in `common | rare | legendary`, number `pulledAt`; `animeTitle` string, `animeTitleNative` string or null. Duplicate `uid`s inside one file are regenerated, not rejected. `imageUrl` must be an `https:` URL (it is rendered into an `<img>`; `security-officer` will ask).

### 4.7 Cross-cutting

| State                                 | User sees                                                                                                                                                                              | User can do                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| save failed (any later write)         | Persistent banner above the main area, `role="alert"`, red style, copy §8 "save-failed-banner" with `Export <name>` and `Try again`. Clears automatically on the next successful write | Export, retry, keep playing |
| active profile changed in another tab | This tab follows: header button, counts and views update; live region `Switched to <name> in another tab.` Any in-progress rename/create dialog stays open on its own data             | Continue                    |
| active profile deleted in another tab | This tab switches to whatever the other tab made active; if none remain, the create screen appears                                                                                     | Continue                    |

## 5. Layout

Breakpoints are Tailwind defaults: phone `< 640`, `sm ≥ 640`, `lg ≥ 1024`. The card grid is unchanged (2 / 3 / 5 columns for the reveal, 2 / 3 / 4 / 5 / 6 for the collection).

**Header**

- Phone (stacked, `flex-col gap-4`): row 1 title + subtitle (unchanged); row 2 `flex items-center justify-between`: view tabs left, profile button right. The profile button hides the card count and truncates the name at `max-w-[8rem]`.
- `sm` and up: title block left; right side is `flex items-end gap-3`: view tabs, then the profile button. Name truncates at `max-w-[10rem]`; card count visible.
- The first-launch screen renders the header without the view tabs and without the profile button; the title block stays so the page is recognisable.

**Switcher menu**: `min-w-[16rem]`, `max-w-[calc(100vw-2rem)]`, anchored to the button's right edge, below it. Rows: avatar `size-6`, name truncates, count right-aligned and `tabular-nums`. Never taller than 10 rows plus two actions, so no inner scroll is needed at the cap.

**Create-profile screen**: one centred panel `w-full max-w-sm` in the main area, `rounded-2xl border border-zinc-800 bg-zinc-900 p-6`, fields full-width, button full-width on phone and auto on `sm`.

**Dialogs** (welcome, create, manage, import preview): native `<dialog>` opened with `showModal()`. `w-[calc(100%-2rem)] max-w-lg` (`max-w-sm` for welcome and create), `max-h-[85vh]`, body scrolls. Backdrop `bg-zinc-950/70 backdrop-blur-sm`. Manage rows on phone stack name/meta above a right-aligned action row; on `sm` a single row with actions right.

**Banners** (storage blocked, save failed): same block as the existing AniList error banner, above the main area, full width.

**Truncation**: names truncate with `truncate` and carry `title={name}` everywhere they are rendered in one line; the welcome, confirm and error panels wrap the name instead.

## 6. Visual treatment

No new design tokens are needed; everything below is existing utilities. (If the engineer finds the red "danger" utilities repeated more than three times, propose a `--color-danger` token in a follow-up; do not add it in this PR.)

- **Avatar placeholder**: circle (`size-7` in the header, `size-6` in menu rows, `size-10` in dialogs), `bg-gradient-to-br from-fuchsia-600 via-violet-600 to-sky-600` (the pack button's gradient), first character of the trimmed name in `text-xs font-bold text-white uppercase`. One gradient for every profile; the name is the differentiator. Roadmap 4 replaces this with a card-art avatar.
- **Profile button**: `rounded-xl bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800`, same focus ring as the Inventory select (`focus-visible:ring-2 focus-visible:ring-violet-500`). Chevron is an inline SVG, `aria-hidden`. Count in `text-xs text-zinc-500`.
- **Menu**: `rounded-xl border border-zinc-800 bg-zinc-900 p-1 shadow-xl shadow-black/40`; items `rounded-lg px-3 py-2 text-sm`; focused/hovered item `bg-zinc-800`; active profile carries a check mark in `text-violet-300`. Divider `border-t border-zinc-800 my-1`.
- **Dialog panel**: `rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100`; headings `text-lg font-bold`; body `text-sm text-zinc-400`.
- **Inputs**: `rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600` with the violet focus ring. Invalid: `border-red-800`; error text `text-xs text-red-300` beneath, prefixed by nothing (no icon). Invite code field: `font-mono tracking-wide`.
- **Buttons**: primary `rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500` (the loud fuchsia→sky gradient stays reserved for the pack); secondary `rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800`; danger outline (row `Delete`) is the existing Inventory `Reset` style `border border-red-900/60 text-red-300 hover:bg-red-950/50`; danger solid (final `Delete <name>`) is the existing banner `Retry` style `bg-red-800/60 text-red-200 hover:bg-red-700/60`. Red is already in use as a semantic colour, not a new accent family.
- **Pills**: `Active` uses the Inventory stat pill (`rounded-md bg-zinc-900 px-2 py-0.5 text-xs`) with `text-violet-300`. Rarity counts in the import preview reuse the same pill with the existing rarity text colours (`text-amber-300`, `text-sky-300`, `text-zinc-200`).
- **Motion**: menu and dialogs fade/scale in over 150 ms (`opacity 0→1`, `scale .98→1`); none under `prefers-reduced-motion`. No motion on switch; the reveal grid simply disappears.
- **Nothing money-like**: no coin, wallet, cart or store iconography anywhere in this feature; the economy spec names and draws the currency.

## 7. Accessibility

- **Profile button**: `<button aria-haspopup="menu" aria-expanded aria-controls="profile-menu">`, accessible name `Switch profile. Current: <name>, <N cards>` via `aria-label` (visible text stays as designed).
- **Menu**: `role="menu"` `aria-labelledby` the button; profile rows `role="menuitemradio"` with `aria-checked`; actions `role="menuitem"`; roving `tabindex`. Keyboard: `Enter`/`Space`/`ArrowDown` open and focus the active profile; `ArrowUp` opens and focuses the last item; `ArrowUp/Down` move and wrap; `Home`/`End`; typing a letter jumps to the next profile starting with it; `Enter`/`Space` activate; `Escape` closes and returns focus to the button; `Tab` closes. Clicking outside closes.
- **Dialogs**: native `<dialog>` via `showModal()` gives the focus trap, `Escape` and background inertness. Each has `aria-labelledby` its heading. Initial focus: the `Name` field in welcome, create and import preview; the dialog element itself (`tabindex="-1"`) in Manage; the `Cancel` button in delete-confirm (so `Enter` by reflex does not delete). Closing returns focus to the element that opened the dialog (profile button, or the row's `Delete`/`Rename` button, or the footer button).
- **Inline rename**: `Escape` stops propagation so it cancels the rename, not the dialog. The field is labelled `New name for <name>` (`sr-only` label).
- **Forms**: every field has a visible `<label>`; hints and errors are linked with `aria-describedby`; invalid fields get `aria-invalid="true"`; on submit, focus moves to the first invalid field. Errors render in a `role="alert"` region inside the form so screen readers hear them once.
- **Invite code field**: `autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text"`. Not a password field; the value is visible (it is not a secret).
- **Live region**: one app-level visually hidden `role="status" aria-live="polite"` element for switch/create/rename/delete/export/import announcements (§8). Banners use `role="alert"`.
- **Manage list**: `<ul>` of `<li>`; each row's action buttons carry the profile name in their accessible name (`Rename Chris`, `Export Chris`, `Delete Chris`) so they are distinguishable out of context.
- **Delete confirm**: the final button's accessible name is `Delete <name>` and the panel is `role="alertdialog"`-equivalent (it is the same `<dialog>`; set `aria-describedby` to the body paragraph).
- **Contrast**: `text-zinc-500` on `bg-zinc-900` for the card count is decorative-adjacent; the count is also in the button's `aria-label`. Everything that must be read (names, errors, body copy) is `zinc-200` or lighter / `red-300` on `zinc-900`.
- **Reduced motion**: only the 150 ms enter transitions exist; they are disabled under `prefers-reduced-motion: reduce`, in the same media block as `card-reveal`.
- **Touch targets**: menu rows and row action buttons are at least 40 px tall on phone.

## 8. Copy

Exact strings. `<name>` is the profile name, `<N>` a number. Card-count phrase everywhere: `No cards yet` / `1 card` / `<N> cards`.

**Header**

| Element                      | Copy                                         |
| ---------------------------- | -------------------------------------------- |
| Profile button `aria-label`  | `Switch profile. Current: <name>, <N cards>` |
| Menu action                  | `New profile…`                               |
| Menu action                  | `Manage profiles…`                           |
| Cap tooltip on disabled item | `This device already has 10 profiles.`       |
| Document title               | `<name> · Anime TCG`                         |

**Create profile (screen and dialog)**

| Element                   | Copy                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Heading                   | `Create your profile` (first launch) / `New profile` (dialog)                                |
| Intro (first launch)      | `Each profile keeps its own collection on this device.`                                      |
| Name label                | `Name`                                                                                       |
| Name placeholder          | `e.g. Chris`                                                                                 |
| Invite code label         | `Invite code`                                                                                |
| Invite code hint          | `Ask the owner for a code. Codes are not case-sensitive.`                                    |
| Submit                    | `Create profile` / while submitting `Creating…`                                              |
| Secondary (first launch)  | `Import a profile file`                                                                      |
| Secondary (dialog)        | `Cancel`                                                                                     |
| Error: empty name         | `Give the profile a name.`                                                                   |
| Error: name too long      | `Keep the name to 24 characters.`                                                            |
| Error: duplicate name     | `A profile called "<name>" already exists.`                                                  |
| Error: empty code         | `Enter an invite code.`                                                                      |
| Error: invalid code       | `That invite code isn't valid.`                                                              |
| Error: at cap             | `This device already has 10 profiles. Delete one to make room.`                              |
| Error: save-failed-create | `Couldn't save the profile. Storage on this device is full or blocked. Nothing was changed.` |
| Live region on success    | `Created <name>. You're now on <name>.`                                                      |

**Welcome dialog (after migration)**

| Element    | Copy                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Heading    | `Your collection has a profile now`                                                                    |
| Body       | `Your <N cards> moved into a profile called Player 1. Give it a name, or keep it and rename it later.` |
| Name label | `Name`                                                                                                 |
| Primary    | `Save`                                                                                                 |
| Secondary  | `Skip`                                                                                                 |

**Migration error panel**

| Element   | Copy                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Heading   | `Couldn't set up your profile`                                                                                                        |
| Body      | `Your <N cards> are still saved as before, but this device wouldn't let us move them into a profile. Storage may be full or blocked.` |
| Primary   | `Try again`                                                                                                                           |
| Secondary | `Export my collection`                                                                                                                |

**Switcher**

| Element                | Copy                                 |
| ---------------------- | ------------------------------------ |
| Live region on switch  | `Switched to <name>.`                |
| Live region, other tab | `Switched to <name> in another tab.` |

**Manage profiles dialog**

| Element                   | Copy                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading                   | `Profiles`                                                                                                                                               |
| Close button `aria-label` | `Close`                                                                                                                                                  |
| Active pill               | `Active`                                                                                                                                                 |
| Row meta                  | `<N cards> · Created <D Mon YYYY>` (e.g. `12 cards · Created 28 Oct 2026`, `Intl.DateTimeFormat` with `day: "numeric", month: "short", year: "numeric"`) |
| Row actions               | `Rename` · `Export` · `Delete`                                                                                                                           |
| Rename field label (sr)   | `New name for <name>`                                                                                                                                    |
| Rename actions            | `Save` · `Cancel`                                                                                                                                        |
| Footer                    | `New profile` · `Import from file`                                                                                                                       |
| Counter                   | `<N> of 10 profiles`                                                                                                                                     |
| Cap helper                | `This device already has 10 profiles. Delete one to make room.`                                                                                          |
| Export failed             | `Couldn't create the file. Try again.`                                                                                                                   |
| Live region on rename     | `Renamed to <name>.`                                                                                                                                     |
| Live region on export     | `Exported <name>.`                                                                                                                                       |

**Delete confirmation**

| Element                  | Copy                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Heading                  | `Delete <name>?`                                                                                               |
| Body                     | `This permanently deletes <name> and its <N cards>. There is no undo. Export it first if you want to keep it.` |
| Extra line, last profile | `This is your only profile. You'll be asked to create a new one.`                                              |
| Buttons                  | `Export first` · `Delete <name>` · `Cancel`                                                                    |
| Error                    | `Couldn't delete the profile. Nothing was changed.` (save-failed-generic)                                      |
| Live region on delete    | `Deleted <name>.`                                                                                              |

**Import**

| Element                   | Copy                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Preview heading           | `Import profile`                                                                                                                   |
| Preview summary           | `<N cards>` then pills `Legendary <L>` `Rare <R>` `Common <C>`, then `Exported <D Mon YYYY>`                                       |
| import-partial note       | `This file also contains data from a newer version that this version of Anime TCG can't use yet. Only the cards will be imported.` |
| Buttons                   | `Import` / `Importing…` · `Cancel`                                                                                                 |
| Error heading             | `Couldn't import that file`                                                                                                        |
| Error: not a profile file | `That file isn't an Anime TCG profile export. Choose a .json file exported from Profiles.`                                         |
| Error: newer version      | `This file was exported by a newer version of Anime TCG. Update the app and try again.`                                            |
| Error: damaged cards      | `This file is damaged: <N> cards couldn't be read. Nothing was imported.`                                                          |
| Error buttons             | `Choose another file` · `Back`                                                                                                     |
| Live region on import     | `Imported <name> with <N cards>. You're now on <name>.`                                                                            |

**Banners**

| Element            | Copy                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage-blocked    | `This browser is blocking storage, so nothing will be saved after you close this tab.`                                                                     |
| save-failed-banner | `Couldn't save to this device. Storage is full or blocked. Your cards are safe in this tab until you close it.` with buttons `Export <name>` · `Try again` |

**Existing copy that changes**

| Element                   | Old                                                     | New                                                   |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Inventory `Reset` confirm | `Delete your entire collection? This cannot be undone.` | `Delete every card in <name>? This cannot be undone.` |

Everything else in the current UI (tabs, pack button, odds line, empty collection, footer) is unchanged.

## 9. Open questions

1. **Invite code values.** What are the Phase 1 invite code(s)? They ship in `src/lib/invites.ts`. If unanswered, the engineer ships the single placeholder `ANIME-TCG-2026` and the e2e tests import whatever the list contains.
2. **Name of the migrated profile.** The spec uses `Player 1`. Fine, or would you rather it took your name (`Chris`)? Either is a one-word change.
3. **Profile cap of 10 per device.** Chosen to keep the switcher readable and stay inside the `localStorage` quota. Raise, lower, or leave?
