# Landing page demo pack (#42)

- **Date:** 2026-10-30
- **Tier:** T3 (a public, unauthenticated route on the RNG and pack-roll code)
- **Verdict:** PASS WITH FINDINGS (none blocking)
- **Owner informed:** through the PR's sign-offs

## Change

Roadmap row D (`docs/design/navigation-and-landing.md` §3.7, §3.8).

- **`GET /api/demo`:** the published odds, the pool size, the timer-pack rules and `perVisit` 10. It is on the global limit.
- **`POST /api/demo/open`:**
  - no body (`Type.Null()`), no query (`NoQuery`), and the CSRF origin check;
  - `DEMO_RATE_LIMIT` 20/min per address as its own bucket;
  - five cards dealt by `planPack("demo")` and `drawPack` on the app's `cryptoRng`: never Enchanted or pity-due, Radiant as every pack;
  - nothing written.
- **Both routes are `sessionless`:** no session lookup, and no Set-Cookie.
- **Web:**
  - the demo control has the pack button's double-click and held-Enter guards;
  - the visit's count and its 429 wait live in app memory for the page load, with a fallback cap of 10 until the facts answer;
  - the facts are fetched once per page load;
  - the shared reveal shows no card effects (owner decision);
  - the odds table and the live numbers.

## Review notes

- **Dependencies:** none changed. `npm run audit` 0 high (4 older dev-only moderates); `npm audit signatures` 488 verified / 166 attestations.
- **`api/test/security/demo.security.test.ts`:**
  - only SELECTs on the snapshot and catalog tables, with no row moved;
  - no Set-Cookie with no, a live or a forged cookie, and a session due for its slide is left untouched;
  - tampered bodies and queries are refused, and no input forces a tier;
  - CSRF is enforced, and the 21st opening is a 429 with nothing rolled;
  - declared keys only, 20 parallel openings write nothing, and only request lines are logged.
- **`api/test/demo.test.ts`:** one script deals the same cards through the demo and through a real opening, and every threshold edge lands on its published tier.
- **`api/test/demo.hunt.test.ts`:**
  - the flag sits on the demo's routes only (checked over the whole route table);
  - a signed-in caller's cookie changes nothing of theirs;
  - 17 odd Origins are refused, and the buckets are independent;
  - 200 000 seeded packs match the published tables;
  - the response size stays bounded with every string at its maximum length.
- **QC:** PASS. The tester's soft-navigation bug was fixed in ee215b8, with its regression tests. The refetch of the facts on every return was fixed in f923881.

## Findings

1. **Low:** limits key on the full client address, so an IPv6 /64 gives one host about 2^64 buckets. Open item.
2. **Info:** the fixed window accepts up to 40 openings across a window edge. Accepted (manager decision, 2026-10-30): the demo writes nothing.
3. **Info:** `DemoOpened.franchises` is bounded by the snapshot limits, not by the schema, at about 278 KB worst case. Accepted.
4. **Info:** the demo's Mythic rate is 0.0584 % per card with Radiant packs, above the 0.05 % standard share, as every free pack's is before its Enchanted and pity rules. Accepted.
5. **Info:** the facts route is on the global limit, at one SELECT per call. Accepted.
6. **Info:** a `sessionless` route skips session rotation, so it may never create or destroy a session. Recorded as a control below.

## Register edits

- **Threat model, append:** From #42 two routes are public and unauthenticated (`GET /api/demo`, `POST /api/demo/open`): anyone on the internet can read the published odds and pool size and have the server roll demo packs that are never stored, so what they gain is load, bounded by `DEMO_RATE_LIMIT` and the global limit per address, and samples of a `crypto.randomInt` generator with nothing to learn from; no card, counter, session or account is reachable from them (C23).
- **C3, append to the status:** #42: `GET /api/demo` and `POST /api/demo/open` are public by design: no `requireAccount`, no account data read or named, and a signed-in caller's cookie is not even read (`sessionless`, C23); `demo.hunt.test.ts` §2 proves a demo opening with a signed-in caller's cookie, a Radiant Mythic deal included, leaves that account's row, packs answer, collection answer and session row unchanged.
- **C6, append to the status:** demo override live (#42, `DEMO_RATE_LIMIT`): 20/min per client address on `POST /api/demo/open`, its own bucket, sized at least twice `perVisit`; `GET /api/demo` stays on the global 100/min; the window is fixed, so up to 40 openings across a window edge are accepted (manager decision, 2026-10-30); every per-address limit keys on the full client address, so IPv6 is limited per /128 (open item).
- **C10, append to the status:** #42: the landing demo deals through the same `planPack` (source `demo`: never Enchanted or pity-due; Radiant at `RADIANT_ODDS`) and `drawPack` on the one `cryptoRng`, writing nothing; no request field reaches the roll; proven by `demo.test.ts` §4, `demo.hunt.test.ts` §5 and `demo.security.test.ts` §2–§3; the demo's Mythic rate is 0.0584 % per card.
- **New control C23:** Sessionless public routes. A route whose config carries `sessionless: true` is never looked up against a session, so it reads, slides, sets and clears no session cookie. It calls no `requireAccount`, `createSession` or `destroySession`, reads only snapshot and catalog tables, and writes nothing.
  - **Where:** API (`api/src/plugins/session.ts`, `api/src/routes/demo/index.ts`).
  - **Status:** live (#42). The flag is set only by route code, on `GET /api/demo` (and its HEAD) and `POST /api/demo/open`.
  - **Proven by:** `demo.hunt.test.ts` §1 (the route table checked with `printRoutes`), and `demo.security.test.ts` §1, §7 and §8.
  - A new sessionless route goes through this register.
- **Open item, add:** Rate limit (#42 S1, low): every per-address limit (C6, `DEMO_RATE_LIMIT` included) keys on the full client address, so one IPv6 host holding a /64 has about 2^64 buckets. With the C15 decision, if the site is reachable over IPv6, give `@fastify/rate-limit` a `keyGenerator` that keys IPv6 on its /64 prefix (and an IPv4-mapped IPv6 address on its IPv4 address), with a test that two addresses in one /64 share a bucket and two /64s do not.
- **Roadmap:** row D shipped (#42).
