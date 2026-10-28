# Accounts (invite code, login + password)

Amended 2026-10-28 for ADR 0006 (login + password)
Amended again 2026-10-28 for ADR 0008 (server-authoritative state; the web app is a thin UI)

Roadmap item 1 · implements [ADR 0008](../adr/0008-server-authoritative.md) §3–4 (which supersedes [ADR 0003](../adr/0003-accounts-local-first.md) Phase 1 and [ADR 0006](../adr/0006-local-credentials.md)) · leaves room for [ADR 0004](../adr/0004-economy-ground-rules.md) · written 2026-10-28

> **Amendment note.** The first version of this spec designed password-less local _profiles_ with a header switcher. ADR 0006 replaced that with _accounts_ that have a login and a password and a Log in / Register flow. ADR 0008 then moved every piece of state to the server. What survives from the earlier versions is the UI: the Account control, the Account screen, the Register and Log in forms, their errors, copy and accessibility. What is gone: the profile switcher, `localStorage` keys, the `StorageAdapter`, browser-side hashing, cross-tab storage events, export/import of collection files, and the migration of the pre-accounts collection. "Profile" no longer appears in UI copy; "account" does.

## 1. Goal

The owner (and anyone they hand the URL and an invite code to) gets an **account** on the owner's server, identified by a login and opened with a password, and always sees whose collection is on screen. Registering needs an invite code; the server checks it. The web app is a thin UI: it shows forms, calls the API, and renders what the server returns. Persistence and credentials are server-side (ADR 0008); the UI calls an API and never stores account or collection data in the browser beyond the session.

## 2. Out of scope

- Third-party sign-in (Google/Discord). ADR 0008 §3 adds it later as an additional provider; this spec must not block it, and does not design it.
- Password reset or recovery. There is no email. See open question 1 for the owner-side alternative.
- Password composition rules beyond length (no "must contain a digit"). Length only, 8–128.
- "Remember me" toggles and session lifetime. The session is a server-side cookie (ADR 0008 §4); how long it lives is the API's decision. The UI only has to cope with it ending (§4.8).
- Migrating the pre-accounts `localStorage` collection (it was a PoC; the server cannot trust client-held data). The first server-side account starts empty (ADR 0008 §7).
- Export and import of a collection as a file. Import is client-held data the server cannot trust (the same reasoning as the point above); export was the matching half and goes with it. A read-only download can return later as a server endpoint; see open question 2.
- Cross-tab synchronisation. There is no `storage` event to listen to any more; a tab that is logged out elsewhere finds out on its next API call (§4.8).
- Trade between accounts (roadmap 7).
- The Profile page: avatar from a card, stats, showcase, balance, next-pack timer (roadmap 4). The initial-letter avatar here is a placeholder that item 4 replaces.
- Currency balance, pack timer, sell/recycle (roadmap 2). Nothing is shown.
- Per-account settings of any kind (there are none yet).
- Any security claim in the UI. The copy never says "secure", "verified", "protected", "safe" or "private". The failure wait on Log in is enforced by the server's rate limiting (ADR 0008 §5) but is _presented_ as a nudge against typo loops, and the copy says exactly that (§8).
- The API's shape (paths, payloads, status codes), the Argon2id parameters, rate limits, CSP. Those are `api/` concerns under ADR 0008 and ADR 0009; this spec only names what the UI needs back from each call.
- Account avatars, colours, more than one signed-in account per tab.

## 3. Flow

Terms: **signed out** = the server reports no session; **signed in** = the server reports a session for an account. **Account screen** = the signed-out main area (§4.3). **Account control** = the header button (§4.5). Every "the server says" below is a response from the API; the UI holds the signed-in account's `login` and `createdAt` in React state for the page's lifetime and nothing else.

### 3.1 Boot (every launch)

1. The app asks the server whether the cookie it may hold belongs to a live session. Until that resolves, nothing game-related renders (no flash of an empty collection); the loading state in §4.1 appears only if it takes longer than 300 ms.
2. Branch on the answer:
   - **Session for an account** → signed in → 3.6 (normal app).
   - **No session** → signed out → 3.2 (Account screen).
   - **Server unreachable or errored** → signed out, Account screen, with the unreachable banner (§4.1). The forms stay usable; each submit retries the network.
3. Nothing is read from `localStorage` at boot. The old `anime-tcg:inventory:v1` key, if present, is ignored and left alone (its bytes are not ours to delete; nothing reads them).

### 3.2 Signed out: the Account screen

1. The header renders with title, subtitle and the Account control (§4.5), no view tabs.
2. The main area shows the **Account screen** (§4.3): heading, one-line intro, two actions **Log in** and **Register**. Below it, the attribution footer, unchanged.
3. Nothing belonging to any account is rendered signed out, and this is server-enforced: without a session the API refuses every account and collection call, so the UI has nothing to show even if it asked. No login list, no card counts, no "last pack".
4. `Log in` → 3.4. `Register` → 3.3. The header Account control, while signed out, returns to this screen from either sub-step (and focuses its heading).

### 3.3 Register (two steps)

1. **Step 1, invite code**: one field, `Continue`, `Back`. The value is trimmed and sent to the server, which checks it case-insensitively against its own list (Phase 1 seeds the single code `ANIME-TCG-2026`; the UI never holds a code list). Codes are reusable unless the server decides otherwise. Validation on submit, not keystroke: empty is a client-side error; invalid, cap reached and unreachable come from the server (§8). No attempt counter on this step.
2. **Step 2, credentials**: `Login`, `Password`, `Confirm password`, `Register`, `Back` (to step 1, code kept). Password rules are printed under the Password field _before_ the user types (§8 "password-rules").
   - Login: trimmed; 3–24 characters; any characters; internal whitespace kept as typed; the server enforces uniqueness case-insensitively on the trimmed value. The login **is** the display name.
   - Password: 8–128 characters, any characters, **never trimmed**. Confirm must match exactly. Length and match are checked client-side first so the server is not called for a typo; the server checks them again and the UI maps its answer to the same messages.
3. On submit the UI sends the invite code, login and password together; the server creates the account, starts the session and answers with the account. The code is re-checked by the server at this point, so a code that became invalid between the steps produces the step-1 error on step 2 (§4.4-A).
4. Success: signed in, Booster tab, header shows the login, live region announces. Focus moves to the pack button. The new collection is empty (ADR 0008 §7).
5. **Cap**: the server holds at most **10 accounts** in Phase 1 (the owner's number, kept). The UI learns of the cap only from the server's answer; it shows the cap error on whichever step returned it and offers `Back`.

### 3.4 Log in

1. `Login` and `Password` fields, `Log in`, `Back`. Password rules are _not_ shown here (the user already chose it). Below the form, the forgotten-password line (§8).
2. Login is trimmed; password is not. Empty fields are client-side errors. The server answers unknown login and wrong password with one failure, and the UI shows one message: `Login or password is incorrect.` The form never says which.
3. **Wait after repeated failures**, server-enforced: after **5 consecutive** failures for a login, the server refuses further attempts for **10 seconds** and tells the UI how many seconds remain. The UI disables `Log in`, counts down from that number (`Try again in <S> s`), and shows the nudge message (§8 "login-breather"), which talks about spelling and caps lock and never about attempts, blocking or protection. A reload does not reset the wait (the server remembers); the UI simply asks again on the next submit and gets a fresh remaining-seconds answer. The same server rule and the same copy family apply to every password check (change password, delete).
4. Success: signed in, Booster tab (the last-used tab is not remembered; a fresh session starts at the pack), header shows the login, live region announces, focus on the pack button.

### 3.5 Signed in: Account control and menu

1. The **Account control** in the header shows the avatar placeholder, the login and a chevron. Activating it opens a menu with exactly two items: `Manage account…`, `Log out`. It is disabled while a pack is mid-open (`opening === true`).
2. `Log out` calls the server (which invalidates the session, ADR 0008 §4), then: the reveal grid is cleared, the view returns to the Account screen, `document.title` resets, focus moves to the Account screen heading, live region announces. No confirmation (nothing is lost). If the call fails, the UI still drops to the Account screen and shows the unreachable banner (the cookie may still be live; the next boot will find out).
3. `Manage account…` opens the **Manage account dialog** (§4.6):
   - **Login** section: current login prefilled in a field, `Save`. Same rules as Register (the server excludes the account itself from the duplicate check). Saving updates the header, `document.title` and the live region.
   - **Password** section: `Current password`, `New password`, `Confirm new password`, rules line under New password, `Change password`. Errors: wrong current password (server), new too short/long, confirm mismatch (client first, server again). Success clears the three fields and announces.
   - **Delete** section: `Delete account…` replaces the dialog body with a confirmation panel: heading, body stating that the account and every card in it are deleted and that there is no undo, a `Password` field, buttons `Delete <login>` (danger), `Cancel`. The delete button is enabled only once the password field is non-empty; a wrong password is an inline error on the field. On success the server ends the session; the UI is signed out on the Account screen, live region announces.

### 3.6 Normal app (signed in)

Identical to today plus: the Account control in the header, `document.title` = `<login> · Anime TCG`, the Inventory `Reset` confirm names the login (§8). The Collection tab keeps its `Collection (N)` label; N comes from the server's collection response. (Moving the collection and pack opening themselves to the server is roadmap work under ADR 0008 and is specced separately; this spec only requires that nothing account-scoped renders without a session.)

### 3.7 Persistence

Persistence and credentials are server-side (ADR 0008); the UI calls an API and never stores account or collection data in the browser beyond the session. The session itself is an `HttpOnly` cookie the UI cannot read; the UI's only memory of "who is signed in" is the account object the server returned, held in React state and discarded on reload. From the UX side the API must give back, for each call, exactly one of: success with the data the states in §4 render; a typed failure that maps to one §8 message (`invalid-code`, `cap-reached`, `duplicate-login`, `bad-credentials`, `wrong-password`, `wait` with seconds remaining, `validation` with the field); `unauthenticated` (session ended); or a network/server failure. The web app maps those and nothing else; it never invents an outcome.

## 4. States

### 4.1 Boot

| State       | User sees                                                                                                                                                                                                   | User can do             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| loading     | Header (title block only); main area shows `Loading…` (`text-sm text-zinc-500`, `aria-live="polite"`) only if the session check takes longer than 300 ms, otherwise nothing                                 | Wait                    |
| unreachable | Account screen with the unreachable banner above it, `role="alert"`, same red style as the AniList error banner, copy §8 "unreachable", button `Try again` (repeats the session check). Forms remain usable | Retry, log in, register |
| signed out  | Account screen (4.3)                                                                                                                                                                                        | Log in, register        |
| signed in   | Normal app (3.6)                                                                                                                                                                                            | Everything              |

### 4.2 Pre-accounts collection

| State   | User sees     | User can do |
| ------- | ------------- | ----------- |
| present | Nothing extra | —           |

There is no migration, no note and no welcome dialog (ADR 0008 §7). The old key is not read and not deleted.

### 4.3 Account screen (signed out)

| State             | User sees                                                                                                                                                                           | User can do    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| choice            | One centred panel: heading, intro line, primary `Log in`, secondary `Register`; attribution footer below the panel as today. No view tabs. No account names, counts or art anywhere | Pick an action |
| log in form       | 4.4-B                                                                                                                                                                               |                |
| register step 1/2 | 4.4-A                                                                                                                                                                               |                |

The UI does not know whether any accounts exist or whether the cap is reached, and does not ask; both buttons are always enabled, and the server's answer to a submit is the only source of those facts.

### 4.4 Forms

**A. Register**

| State                          | User sees                                                                                                                                                                       | User can do            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| step 1 idle                    | Heading `Register`, step indicator `Step 1 of 2`, `Invite code` field (autofocused) with hint, `Continue`, `Back`                                                               | Type, continue, back   |
| step 1 checking                | `Checking…`, button and field disabled                                                                                                                                          | Wait                   |
| step 1 error: empty code       | Field `aria-invalid`, red border, message below (§8), focus to the field. No server call                                                                                        | Fix                    |
| step 1 error: invalid code     | Same treatment, message §8 (from the server). No counter, no delay in the UI                                                                                                    | Fix                    |
| step 1 error: cap reached      | Form body replaced by the cap message (§8) and `Back`                                                                                                                           | Back                   |
| step 1 error: unreachable      | Banner inside the form (`role="alert"`), §8 "unreachable-form"; field keeps its value                                                                                           | Retry                  |
| step 2 idle                    | `Step 2 of 2`, `Login` (autofocused) with hint, `Password` with the rules line _under it before typing_ and a `Show` toggle, `Confirm password` with toggle, `Register`, `Back` | Type, submit, back     |
| step 2 error: empty login      | Invalid treatment, §8                                                                                                                                                           | Fix                    |
| step 2 error: login length     | Invalid treatment, §8 (too short / too long are one message)                                                                                                                    | Fix                    |
| step 2 error: duplicate        | Invalid treatment, message names the clash (from the server)                                                                                                                    | Fix                    |
| step 2 error: empty password   | Invalid treatment, §8                                                                                                                                                           | Fix                    |
| step 2 error: password length  | Invalid treatment, §8 (too short / too long are one message)                                                                                                                    | Fix                    |
| step 2 error: mismatch         | `Confirm password` invalid, §8; the Password field keeps its value                                                                                                              | Fix                    |
| step 2 error: several          | All marked; focus to the first invalid in DOM order                                                                                                                             | Fix                    |
| step 2 error: code now invalid | The server rejected the code at submit time: back to step 1 with the invalid-code error shown and the code field focused; the login stays filled for when the user returns      | Fix the code           |
| step 2 error: cap reached      | Form body replaced by the cap message and `Back`                                                                                                                                | Back                   |
| step 2 error: unreachable      | Form stays filled; banner inside the form, §8 "unreachable-form"                                                                                                                | Retry; nothing created |
| submitting                     | `Registering…`, button, fields and toggles disabled                                                                                                                             | Wait                   |
| success                        | Normal app on the Booster tab, header shows the login, live region announces                                                                                                    | Open a pack            |

**B. Log in**

| State                 | User sees                                                                                                                                                                                            | User can do   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| idle                  | Heading `Log in`, `Login` (autofocused), `Password` with `Show` toggle, `Log in`, `Back`, forgotten-password line beneath the form                                                                   | Type, submit  |
| error: empty login    | Invalid treatment, §8. No server call                                                                                                                                                                | Fix           |
| error: empty password | Invalid treatment, §8. No server call                                                                                                                                                                | Fix           |
| error: incorrect      | Both fields get the invalid border; one message under the password field: `Login or password is incorrect.`; password field cleared; focus to `Login`                                                | Fix           |
| checking              | `Logging in…`, disabled                                                                                                                                                                              | Wait          |
| wait (server says so) | `Log in` disabled and reads `Try again in <S> s` (S from the server's remaining seconds down to 1, `tabular-nums`); message `role="status"` §8 "login-breather" announced once; fields stay editable | Re-read, wait |
| wait over             | Button reads `Log in` again; live region `You can try again now.`                                                                                                                                    | Submit        |
| error: unreachable    | Banner inside the form, §8 "unreachable-form"; fields keep their values                                                                                                                              | Retry         |
| success               | Normal app on the Booster tab, live region announces                                                                                                                                                 | Play          |

**C. Change password** (inside Manage account)

| State                  | User sees                                                                                                            | User can do  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| idle                   | `Current password`, `New password` with rules line and toggle, `Confirm new password` with toggle, `Change password` | Type, submit |
| error: wrong current   | `Current password` invalid, §8 "wrong-current"; field cleared                                                        | Fix          |
| error: new length      | `New password` invalid, same length message as Register                                                              | Fix          |
| error: mismatch        | `Confirm new password` invalid, same mismatch message                                                                | Fix          |
| error: same as current | Not an error; allowed. No message                                                                                    | —            |
| wait                   | Same server-enforced wait, countdown and copy family as Log in, on the `Change password` button                      | Wait         |
| submitting             | `Changing…`, disabled                                                                                                | Wait         |
| error: unreachable     | Inline banner §8 "unreachable-form"                                                                                  | Retry        |
| success                | Fields cleared, inline confirmation line `Password changed.` and live region announces                               | Continue     |

### 4.5 Account control (header)

| State             | User sees                                                                                                                        | User can do                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| signed out        | Button labelled `Account` (no avatar, no chevron). Activating it shows the Account screen "choice" state and focuses its heading | Return to the choice screen         |
| signed in, closed | Avatar circle with the first character of the login, the login, chevron                                                          | Open                                |
| signed in, open   | Menu anchored below the button, right-aligned: `Manage account…`, divider, `Log out`                                             | Pick an item, Escape, click outside |
| disabled          | Button `disabled` while a pack is opening                                                                                        | Wait ~350 ms                        |
| logging out       | Menu closed; control disabled until the server answers (sub-second)                                                              | Wait                                |
| after Log out     | Account screen, choice state; `document.title` = `Anime TCG`; focus on the screen heading; live region `Logged out.`             | Log in, register                    |

### 4.6 Manage account dialog

| State           | User sees                                                                                                                                                                                                                                     | User can do                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| open            | Modal titled `Manage account`, close button, avatar + login + `Created <date>` + `<N cards>` at the top, then three sections in order: **Login**, **Password**, **Delete account**                                                            | Any action, close, Escape            |
| login editing   | `Login` field prefilled; `Save` enabled once the value differs from the current login                                                                                                                                                         | Save                                 |
| login error     | Same inline treatment as Register (empty / length / duplicate)                                                                                                                                                                                | Fix                                  |
| login saving    | `Saving…`, disabled                                                                                                                                                                                                                           | Wait                                 |
| login saved     | Header, `document.title` and the dialog header update; live region `Login changed to <login>.`                                                                                                                                                | Continue                             |
| password        | 4.4-C                                                                                                                                                                                                                                         |                                      |
| delete confirm  | Dialog body replaced by: heading `Delete <login>?`, body naming the card count and "no undo", `Password` field (autofocused, `current-password`, toggle), buttons `Delete <login>` (danger, enabled only with a non-empty password), `Cancel` | Delete, cancel/Escape (back to list) |
| delete wrong pw | Password field invalid, §8 "wrong-current"; field cleared; same server-enforced wait on the delete button after repeated misses                                                                                                               | Retry, cancel                        |
| deleting        | `Deleting…`, disabled                                                                                                                                                                                                                         | Wait                                 |
| delete done     | Dialog closes; app is signed out on the Account screen; live region `Deleted <login>.`                                                                                                                                                        | Log in, register                     |
| delete failed   | Stays on the confirm panel with the inline banner (§8 "unreachable-form"). The server deletes atomically or not at all; the UI never shows a half-deleted account                                                                             | Retry, cancel                        |
| session ended   | Any `unauthenticated` answer closes the dialog and applies §4.8                                                                                                                                                                               | Log in                               |

### 4.7 (reserved)

Import from a file was §4.7 in the previous version and is out of scope now (§2). The number is kept so cross-references in review comments stay valid.

### 4.8 Cross-cutting

| State                                                     | User sees                                                                                                                                                                                              | User can do |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| session ended (server says `unauthenticated` on any call) | The UI drops to the Account screen, closes any dialog, clears the reveal grid and all account state; banner above the panel, `role="status"`, §8 "session-ended"; the Log in form is one click away    | Log in      |
| server unreachable (any later call)                       | Persistent banner above the main area, `role="alert"`, red style, copy §8 "unreachable" with `Try again`. The game state on screen is whatever the server last returned; no action pretends to succeed | Retry, wait |
| logged out in another tab                                 | Nothing until this tab's next API call, which returns `unauthenticated` and triggers "session ended" above. This is accepted (§2)                                                                      | Log in      |

## 5. Layout

Breakpoints are Tailwind defaults: phone `< 640`, `sm ≥ 640`, `lg ≥ 1024`. The card grid is unchanged (2 / 3 / 5 columns for the reveal, 2 / 3 / 4 / 5 / 6 for the collection).

**Header**

- Phone (stacked, `flex-col gap-4`): row 1 title + subtitle (unchanged); row 2 `flex items-center justify-between`: view tabs left (signed in only), Account control right. Signed out, row 2 is the Account control alone, right-aligned. The login truncates at `max-w-[8rem]`.
- `sm` and up: title block left; right side is `flex items-end gap-3`: view tabs (signed in only), then the Account control. Login truncates at `max-w-[10rem]`.

**Account screen and its sub-steps (choice, Log in, Register)**: one centred panel `w-full max-w-sm` in the main area, `rounded-2xl border border-zinc-800 bg-zinc-900 p-6`, fields full-width, primary buttons full-width on phone and auto on `sm`. The two choice buttons stack on phone and sit side by side on `sm`. The attribution footer keeps its place below `main`.

**Menu**: `min-w-[12rem]`, anchored to the control's right edge, below it. Two items; never scrolls.

**Dialog** (Manage account): native `<dialog>` opened with `showModal()`. `w-[calc(100%-2rem)] max-w-lg`, `max-h-[85vh]`, body scrolls. Backdrop `bg-zinc-950/70 backdrop-blur-sm`. Sections are stacked with `border-t border-zinc-800 pt-6 mt-6` between them; each has an `h3`. On phone the login field and `Save` stack; on `sm` they share a row.

**Password fields**: the input gets `pr-16` and the `Show`/`Hide` text toggle is absolutely positioned inside the right edge, vertically centred, so the field width never changes when the label flips.

**Banners** (unreachable, session ended): same block as the existing AniList error banner, above the main area, full width. Session-ended uses the neutral style (`border-zinc-800 bg-zinc-900 text-zinc-200`), not red: it is information, not a failure.

**Truncation**: logins truncate with `truncate` and carry `title={login}` everywhere they are rendered in one line; headings and confirm panels wrap the login instead.

## 6. Visual treatment

No new design tokens are needed; everything below is existing utilities. (If the engineer finds the red "danger" utilities repeated more than three times, propose a `--color-danger` token in a follow-up; do not add it in this PR.)

- **Avatar placeholder**: circle (`size-7` in the header, `size-10` in the Manage dialog header), `bg-gradient-to-br from-fuchsia-600 via-violet-600 to-sky-600` (the pack button's gradient), first character of the login in `text-xs font-bold text-white uppercase`. Roadmap 4 replaces this with a card-art avatar.
- **Account control**: `rounded-xl bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800`, same focus ring as the Inventory select (`focus-visible:ring-2 focus-visible:ring-violet-500`). Signed out it is the same button with the text `Account` and no avatar. Chevron is an inline SVG, `aria-hidden`.
- **Menu**: `rounded-xl border border-zinc-800 bg-zinc-900 p-1 shadow-xl shadow-black/40`; items `rounded-lg px-3 py-2 text-sm`; focused/hovered item `bg-zinc-800`; `Log out` is plain `text-zinc-200` (it is not destructive). Divider `border-t border-zinc-800 my-1`.
- **Panel / dialog**: `rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100`; headings `text-lg font-bold`; section headings `text-sm font-semibold text-zinc-200`; body `text-sm text-zinc-400`; step indicator `text-xs text-zinc-500`.
- **Inputs**: `rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600` with the violet focus ring. Invalid: `border-red-800`; error text `text-xs text-red-300` beneath (no icon). Hints and the rules line: `text-xs text-zinc-500`. Invite code field: `font-mono tracking-wide`. Password fields never use `font-mono` (it makes shoulder-reading easier and looks like a code).
- **Show/Hide toggle**: text button `text-xs font-medium text-zinc-400 hover:text-zinc-200`, violet focus ring, no icon (no new iconography in this feature).
- **Buttons**: primary `rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500` (the loud fuchsia→sky gradient stays reserved for the pack); secondary `rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800`; disabled `opacity-50 cursor-not-allowed`; danger outline (`Delete account…`) is the existing Inventory `Reset` style `border border-red-900/60 text-red-300 hover:bg-red-950/50`; danger solid (final `Delete <login>`) is the existing banner `Retry` style `bg-red-800/60 text-red-200 hover:bg-red-700/60`. Red is already in use as a semantic colour, not a new accent family.
- **Wait countdown**: the disabled primary button with `tabular-nums`; the message beneath in the hint style, not the error style (it is not an error).
- **Motion**: menu and dialog fade/scale in over 150 ms (`opacity 0→1`, `scale .98→1`); none under `prefers-reduced-motion`. Switching between Account screen sub-steps has no transition. The countdown number changes without animation.
- **Nothing money-like, nothing lock-like**: no coin, wallet, cart, lock, shield or key iconography anywhere in this feature; the economy spec names and draws the currency, and a lock would be a security claim.

## 7. Accessibility

- **Account control (signed in)**: `<button aria-haspopup="menu" aria-expanded aria-controls="account-menu">`, accessible name `Account menu. Signed in as <login>` via `aria-label` (visible text stays as designed). Signed out: a plain `<button>` whose visible text `Account` is its name.
- **Menu**: `role="menu"` `aria-labelledby` the button; items `role="menuitem"`; roving `tabindex`. Keyboard: `Enter`/`Space`/`ArrowDown` open and focus the first item; `ArrowUp` opens and focuses the last; `ArrowUp/Down` move and wrap; `Home`/`End`; `Enter`/`Space` activate; `Escape` closes and returns focus to the button; `Tab` closes. Clicking outside closes.
- **Account screen**: `<main>` contains one `<section aria-labelledby>` its `h2`. The heading has `tabindex="-1"` so the header control, Log out and session-ended can move focus to it. Sub-steps (Log in, Register) replace the section's content; their `h2` receives focus on entry. `Back` returns focus to the choice screen's heading.
- **Register steps**: step indicator is text (`Step 1 of 2`), part of the heading's `aria-describedby`. Step 2's `Back` keeps the entered code; a server-side code rejection at submit returns to step 1 with focus on the code field.
- **Dialog**: native `<dialog>` via `showModal()` gives the focus trap, `Escape` and background inertness, `aria-labelledby` its heading. Initial focus: the dialog element itself (`tabindex="-1"`) in Manage account; the `Password` field in delete-confirm (the user has to type anyway, and `Enter` with an empty field does nothing because the delete button is disabled). Closing returns focus to the Account control.
- **Forms**: every field has a visible `<label>`; hints, rules and errors are linked with `aria-describedby`; invalid fields get `aria-invalid="true"`; on submit, focus moves to the first invalid field in DOM order, whether the error came from the client check or from the server. Errors render in a `role="alert"` region inside the form so screen readers hear them once. Validation on submit, not on keystroke. While a request is in flight the submit button is disabled and keeps focus; it is not removed from the DOM.
- **Password fields**: `type="password"`; each has its own Show/Hide `<button type="button" aria-pressed>` with accessible name `Show password` / `Hide password` (for confirm fields: `Show password confirmation` / `Hide password confirmation`). Toggling does not move focus and does not clear the value. Toggles are disabled while the form is submitting. `autocomplete`: Register `Login` → `username`, `Password` and `Confirm password` → `new-password`; Log in `Login` → `username`, `Password` → `current-password`; Manage `Login` → `username`; `Current password` → `current-password`; `New password` and `Confirm new password` → `new-password`; delete-confirm `Password` → `current-password`. `autocapitalize="off" spellcheck="false"` on every login and password field. No `maxlength` attribute on passwords (a hard cut-off would silently truncate what the user thinks they typed; validate on submit instead); `maxlength="24"` is fine on login.
- **Invite code field**: `autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text"`. Not a password field; the value is visible (it is not a secret).
- **Wait**: the message is a `role="status"` element rendered once when the wait starts; the countdown lives in the button's text, which is _not_ a live region, so screen readers are not read a number every second. When the wait ends, the live region announces `You can try again now.` and focus is unchanged.
- **Live region**: one app-level visually hidden `role="status" aria-live="polite"` element for register/login/logout/rename/password/delete announcements (§8). Failure banners use `role="alert"`; the session-ended banner uses `role="status"` and moves focus to the Account screen heading, which is why it does not need to be an alert.
- **Delete confirm**: the final button's accessible name is `Delete <login>`; the panel sets `aria-describedby` to the body paragraph.
- **Contrast**: hints and rules in `text-zinc-500` on `bg-zinc-900` are at the floor; everything that must be read (logins, errors, body copy) is `zinc-200` or lighter / `red-300` on `zinc-900`.
- **Reduced motion**: only the 150 ms enter transitions exist; they are disabled under `prefers-reduced-motion: reduce`, in the same media block as `card-reveal`.
- **Touch targets**: menu items, toggles and form buttons are at least 40 px tall on phone.

## 8. Copy

Exact strings. `<login>` is the account login, `<N>` a number, `<S>` the countdown seconds. Card-count phrase everywhere: `No cards yet` / `1 card` / `<N> cards`. The words "secure", "verified", "protected", "safe", "private", "attempt", "locked" and "blocked" do not appear in any string below and must not be added.

**Header**

| Element                         | Copy                                 |
| ------------------------------- | ------------------------------------ |
| Control, signed out             | `Account`                            |
| Control `aria-label`, signed in | `Account menu. Signed in as <login>` |
| Menu items                      | `Manage account…` · `Log out`        |
| Document title, signed in       | `<login> · Anime TCG`                |
| Document title, signed out      | `Anime TCG`                          |

**Account screen (choice)**

| Element   | Copy                                                                    |
| --------- | ----------------------------------------------------------------------- |
| Heading   | `Your account`                                                          |
| Intro     | `Log in to your collection, or register a new one with an invite code.` |
| Primary   | `Log in`                                                                |
| Secondary | `Register`                                                              |

**Register**

| Element                              | Copy                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Heading                              | `Register`                                                                |
| Step indicator                       | `Step 1 of 2` / `Step 2 of 2`                                             |
| Invite code label                    | `Invite code`                                                             |
| Invite code hint                     | `Ask the owner for a code. Codes are not case-sensitive.`                 |
| Step 1 buttons                       | `Continue` / while checking `Checking…` · `Back`                          |
| Error: empty code                    | `Enter an invite code.`                                                   |
| Error: invalid code                  | `That invite code isn't valid.`                                           |
| Error: cap reached                   | `All 10 places are taken for now. Ask the owner to make room.`            |
| Login label                          | `Login`                                                                   |
| Login hint                           | `3 to 24 characters. This is the name shown on your collection.`          |
| Login placeholder                    | `e.g. Chris`                                                              |
| Password label                       | `Password`                                                                |
| password-rules (shown before typing) | `8 to 128 characters. Letters, numbers, spaces and symbols are all fine.` |
| Confirm label                        | `Confirm password`                                                        |
| Show/Hide toggle                     | `Show` / `Hide`                                                           |
| Step 2 buttons                       | `Register` / while submitting `Registering…` · `Back`                     |
| Error: empty login                   | `Choose a login.`                                                         |
| Error: login length                  | `Keep the login between 3 and 24 characters.`                             |
| Error: duplicate login               | `The login "<login>" is already taken.`                                   |
| Error: empty password                | `Choose a password.`                                                      |
| Error: password length               | `Keep the password between 8 and 128 characters.`                         |
| Error: mismatch                      | `The passwords don't match.`                                              |
| Live region on success               | `Registered <login>. You're now on <login>.`                              |

**Log in**

| Element                 | Copy                                                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading                 | `Log in`                                                                                                                                                                                                                                                                |
| Login label             | `Login`                                                                                                                                                                                                                                                                 |
| Password label          | `Password`                                                                                                                                                                                                                                                              |
| Buttons                 | `Log in` / while checking `Logging in…` · `Back`                                                                                                                                                                                                                        |
| Countdown button        | `Try again in <S> s`                                                                                                                                                                                                                                                    |
| Error: empty login      | `Enter your login.`                                                                                                                                                                                                                                                     |
| Error: empty password   | `Enter your password.`                                                                                                                                                                                                                                                  |
| Error: incorrect        | `Login or password is incorrect.`                                                                                                                                                                                                                                       |
| login-breather (status) | `Five misses in a row. Take ten seconds, check the spelling of your login and whether caps lock is on, then try again.`                                                                                                                                                 |
| Wait over (live)        | `You can try again now.`                                                                                                                                                                                                                                                |
| Forgotten password line | `There is no way to recover a forgotten password.` (ADR 0006 §5's first sentence; its second sentence, "You can delete the account from this device.", is dropped because the account is no longer on the device and delete requires the password. See open question 1) |
| Live region on success  | `Logged in. You're now on <login>.`                                                                                                                                                                                                                                     |

**Account menu actions**

| Element                | Copy          |
| ---------------------- | ------------- |
| Live region on log out | `Logged out.` |

**Manage account dialog**

| Element                          | Copy                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Heading                          | `Manage account`                                                                                                  |
| Close button `aria-label`        | `Close`                                                                                                           |
| Meta line                        | `<N cards> · Created <D Mon YYYY>` (`Intl.DateTimeFormat` with `day: "numeric", month: "short", year: "numeric"`) |
| Section: Login                   | `Login`                                                                                                           |
| Login field label (sr)           | `New login`                                                                                                       |
| Login save                       | `Save` / while saving `Saving…`                                                                                   |
| Live region on login change      | `Login changed to <login>.`                                                                                       |
| Section: Password                | `Password`                                                                                                        |
| Current password label           | `Current password`                                                                                                |
| New password label               | `New password`                                                                                                    |
| Confirm new label                | `Confirm new password`                                                                                            |
| Change button                    | `Change password` / while submitting `Changing…`                                                                  |
| Error: wrong-current             | `That password is incorrect.`                                                                                     |
| Password changed (inline + live) | `Password changed.`                                                                                               |
| Section: Delete                  | `Delete account`                                                                                                  |
| Delete explanation               | `Deleting removes this account and every card in it. There is no undo.`                                           |
| Delete trigger                   | `Delete account…`                                                                                                 |

**Delete confirmation**

| Element               | Copy                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| Heading               | `Delete <login>?`                                                       |
| Body                  | `This permanently deletes <login> and its <N cards>. There is no undo.` |
| Password label        | `Password`                                                              |
| Buttons               | `Delete <login>` / while deleting `Deleting…` · `Cancel`                |
| Error: wrong password | `That password is incorrect.`                                           |
| Live region on delete | `Deleted <login>.`                                                      |

**Banners and in-form failures**

| Element          | Copy                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| unreachable      | `Couldn't reach the game server. Check your connection and try again.` with button `Try again` |
| unreachable-form | `Couldn't reach the game server. Nothing was changed. Try again.`                              |
| session-ended    | `You were logged out. Log in again to continue.`                                               |

**Existing copy that changes**

| Element                   | Old                                                     | New                                                    |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Inventory `Reset` confirm | `Delete your entire collection? This cannot be undone.` | `Delete every card in <login>? This cannot be undone.` |

Everything else in the current UI (tabs, pack button, odds line, empty collection, footer) is unchanged.

## 9. Open questions

1. **Forgotten password: can you, as the owner, reset one?** With the server in your hands this is now possible (a command on the NAS that sets a new password for a login). If yes, the forgotten-password line becomes `There is no way to recover a forgotten password yourself. Ask the owner to set a new one.` and the API needs an owner-only reset path (specced with the backend, not here). If no, the line stays `There is no way to recover a forgotten password.` and a forgotten password means a dead account until you delete it in the database. The spec ships the shorter line until you choose.
2. **Collection download.** Export and import of collection files are dropped (import can't be trusted; export went with it). Do you want a read-only `Download my collection` back as a server endpoint in a later item (a one-line menu entry and a copy row here), or is the NAS backup (ADR 0007 §6) enough?
