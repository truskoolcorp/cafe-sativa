# Pinned Café fonts and build reliability

## Observed failure and diagnosis

Vercel preview `dpl_4uVoGtSM1GdcsHjCsC2xHSeBR3hS`, PR48 commit
`9884ca1bb11774d6562b006671532f389c851ef5`, restored the earlier production
build cache and failed during Next 14.2.35 compilation of `app/layout.tsx`:

```
TypeError: Cannot read properties of null (reading '1')
next/dist/compiled/@next/font/dist/google/loader.js:112:78
Promise.all (index 3)
```

The layout's Google font import was unchanged by the capability patch. That
loader first fetches Google CSS, extracts `src: url(...)` values and downloads
the fonts. It then evaluates:

```
/\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]
```

The regular expression assumes every URL ends in a bare recognized extension.
A valid font URL with a query suffix, an extensionless endpoint, or surrounding
quotes fails that assumption and throws the observed error after a successful
font download. This is a deterministic parser defect for those inputs, not a
TypeScript failure. A local fixture using the real installed loader and a
query-suffixed URL reproduces the exact error and source line.

The failed build logs do not record the offending URL or CSS response. Fresh
requests using Next's exact user agent returned ordinary extension-ending URLs
for all seven Inter and four Playfair Display files. Therefore the exact failing
response and whether cache/edge variation triggered it are **not established**.
Do not claim a permanent upstream format change, a corrupted cache, or that a
retry alone fixes the defect. Cache invalidation would leave remote CSS and
network availability as build dependencies.

## Repair

`app/layout.tsx` imports the checked-in `app/fonts.css` instead of
`next/font/google`. The stylesheet points to unchanged WOFF2 binaries under
`public/fonts`. No framework upgrade, dependency, loader patch, postinstall
script, Google browser request, or new font provider is introduced.

The repair preserves:

- Playfair Display at weights 400, 600 and 700, and Inter at weights 100–900.
- All previously returned Unicode subsets, not just the preloaded Latin subset.
- The two original Latin preloads, with font/woff2 and anonymous CORS semantics.
- `font-display: swap`, `--font-playfair` and `--font-inter` and existing Tailwind
  font-family utilities.
- The exact fallback ascent/descent/line-gap/size-adjust metrics used by Next
  14.2.35, including Times New Roman for Playfair and Arial for Inter.

The eleven files total 308,528 bytes. Only the two Latin files (86,892 bytes)
are preloaded; other subsets remain selected by CSS unicode-range when needed.
The names in the font metadata are Inter 4.001 and Playfair Display 1.203.
These are the current official files returned for the existing layout's exact
Google CSS queries, not substitute fonts. Their bytes are not edited, subsetted
or recompressed. The previously successful production build's exact font bytes
are not available in this evidence, so pixel-identical production comparison
still belongs to preview visual QA.

`public/fonts/manifest.json` records the source CSS URLs, request user agent,
retrieval date and every downloaded file's URL, byte length and SHA-256 hash.
The original copyright notices and SIL Open Font License 1.1 texts are included
as `inter-OFL.txt` and `playfair-OFL.txt`. No renamed or modified font derivative
is distributed. Future updates must retain the license notices, review
upstream font/version changes, update hashes, and rerun the regressions.

## Validation

`tests/site-fonts.test.cjs` verifies the local layout/preloads, every binary's
hash and WOFF2 signature, genuine family names and variable weight axes,
Café/Spanish/euro glyphs, all Unicode subsets, expected CSS weights and swap,
existing fallback metrics, and both original OFL license files. The concierge
CI workflow includes the new regression and its relevant paths.

The local Next production compiler succeeds with all network connections
blocked, telemetry disabled, no service credentials and no mocked fonts:

```
next build --experimental-build-mode compile --no-lint
```

This compile-only check does not prerender pages, contact a database/provider,
run full production data collection, or prove browser/CDN behavior. Strict
TypeScript and the full 98-test concierge/font regression suite are separate
checks. Hosted build and preview visual validation are still required after
any separately authorized publication. No deployment or production changes
are part of this local repair.
