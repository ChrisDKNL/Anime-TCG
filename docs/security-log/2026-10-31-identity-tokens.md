# Visual identity PR 1: tokens, fonts, page header (#69)

- **Date:** 2026-10-31
- **Tier:** T2 (three new runtime dependencies)
- **Verdict:** PASS WITH FINDINGS, reviewed at head faff82b; then PASS at d189337 after dcfb3cc (finding 1) and 4dbce8c (finding 2)
- **Owner informed:** through the PR's sign-offs

## Change

Redesign build PR 1 (`docs/design/visual-identity.md` §4.1, §9.1, §10.1, §11.1, §12, §15 row 1). Web only: no api, shared, CI, Caddyfile, Dockerfile or compose change.

- **Dependencies:** `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree` and `@fontsource-variable/martian-mono`, each 5.3.0, OFL-1.1, pinned exactly in `web/package.json`. They ship CSS and woff2 files only, with no JavaScript, no install scripts and no dependencies. `web/src/main.tsx` imports their `wdth`/`wght` CSS, and Vite bundles the woff2 files into `/assets`.
- **Licences:** a Vite plugin, `web/font-licenses.ts`, reads each package's `LICENSE` (a fixed list, resolved through each package's `exports`) and writes them into the build as `/licenses/fonts.txt`. The dev server answers the same path with the same fixed text, as `text/plain`. The footer gains a second line, `Fonts: Bricolage Grotesque, Figtree, Martian Mono (SIL Open Font License).`, which links to that file.
- **Look:** identity tokens in `web/src/index.css`, every `zinc-*` remapped to night/ink, a flat night ground (the radial wash is gone), Volt buttons and focus ring, and danger error text.
- **Page header:** every page shows a constant eyebrow from the route list (`aria-hidden`) above its `h1`. `page-enter` plays on a navigation only (`router.state.resolvedLocation`) and never under reduced motion.
- **Never:** no client storage beyond TanStack Router's `tsr-scroll-restoration-v1_3`, no inline script or style, no HTML sink, no off-site request.

## Review notes

- **Supply chain:**
  - Maintainers `jwr1` and `lotusdevshack`, the same as the rest of fontsource. Each package was created in 2023 and has 17 to 33 versions. 5.3.0 was published 2026-07-19 and is `latest`.
  - SLSA v1 provenance for all three: `github.com/fontsource/font-files`, `.github/workflows/bump-minor.yml` on `main`, commit `02b28c06`.
  - Each lockfile integrity equals the registry's `dist.integrity`, and no transitive package is added.
  - `npm run audit` finds 0 high (the dev-only moderates are unchanged), and `npm audit --omit=dev` finds 0. `npm audit signatures` reports 491 verified and 169 attestations (+3 each).
- **Package contents:** every `url()` in the packages' CSS is `./files/…`, and the only `.ts` file is `export {}`.
- **Plugin:** no request data reaches a path or the response. The dev server binds localhost. The build emits exactly `licenses/fonts.txt`, which holds each package's LICENSE byte for byte. Caddy serves it from the catch-all with `no-cache` and the site headers.
- **Build output:** `index.html` holds one module script and one stylesheet link. Every font is under `/assets` (after the fix), and the bundle names no remote origin beyond the existing `anilist.co` footer link.
- **CSP probe:** the production build was served under the Caddyfile's exact CSP in Chromium. At faff82b one face is blocked (finding 1). After the fix there are no violations, and every Martian Mono face, `cyrillic-ext` included, loads from `/assets`.
- **Licence (OFL §2):** each copyright notice and the full OFL 1.1 ship as a standalone text file linked from every page's footer. No Reserved Font Name is declared.
- **Re-review at d189337:** a fresh production build has no `data:` URL and 9 woff2 files under `/assets`; served under the Caddyfile's CSP in Chromium it reports no violations and every face, Martian Mono's `cyrillic-ext` included, loads. `09e55cc`, `91930d7`, `86b0833` and `d189337` change Tailwind classes only (44 px phone targets, `ink-400` loading text, the Volt focus ring on the Account menu items and the Duplicates checkbox).
- **Visual-only changes:** the route keys are unchanged (C19), and the eyebrows are constant text (C9).

## Findings

1. **Low:** Vite's default `assetsInlineLimit` (4 KiB) inlined Martian Mono's `cyrillic-ext` subset (3172 bytes) into the CSS as a `data:` URL, which `font-src 'self'` refused, so every production page load reported a CSP violation and that face failed. Fixed before merge in dcfb3cc with `build.assetsInlineLimit: 0`; the CSP is not widened.
2. **Info:** the CSP e2e checks ran only on the dev server, which never inlines assets, so finding 1 was invisible to them. Fixed before merge in 4dbce8c: `web/src/build.fonts.test.ts` runs a real `vite build` inside `npm run check` and fails on any `data:` font source, and `web/e2e/stack.spec.ts` checks `/licenses/fonts.txt` and the fonts under the live CSP through Caddy.

## Register edits

- **C8, extend status:** `; #69 (identity fonts): no directive changes; the three self-hosted families are served from `/assets`under`font-src 'self'`, and `build.assetsInlineLimit: 0`keeps every asset a file, because the CSP allows`data:`for no directive;`/licenses/fonts.txt` is a static file under the site headers`
- **C13, extend status:** `; #69 adds `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree`and`@fontsource-variable/martian-mono`5.3.0 (OFL-1.1, pinned exactly; CSS and woff2 only, no scripts, no transitive packages; SLSA provenance from`fontsource/font-files`; published 2026-07-19); their LICENSE files ship as `/licenses/fonts.txt`through`web/font-licenses.ts``
- **Threat model:** none.
- **Open items:** none.
