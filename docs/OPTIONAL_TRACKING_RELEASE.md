# Optional tracking preparation

This change prepares consent-controlled tracking for Café Sativa. It is a draft,
not approval to publish the revised privacy notice or enable either provider.

## Verified baseline

- Main and production commit: `0fa419beb24c88be62eeca30342355528c4ce506`.
- Vercel project: `virtual-cafe-sativa`, production domain `www.cafe-sativa.com`.
- Café-Sativa dataset shown in Events Manager: `1079070821826891`.
- Do not substitute the Tru Skool dataset `890286235618568`.
- Dataset ownership and assignment to ad account `5864024920311248` remain to be
  checked in Meta before activation.

## Changes

- Separate analytics and marketing choices, off by default. Reject optional,
  Accept optional, and Manage choices appear together. The footer always offers
  Privacy choices. Cancel or Escape does not grant consent.
- First-party versioned localStorage record with only the two choices, a decision
  flag and timestamp. It expires after 180 days. Invalid or inaccessible saved
  data fails closed. Global Privacy Control prevents optional consent.
- Consent synchronizes across tabs, document visibility and BFCache restoration.
  Expiry and Global Privacy Control are rechecked during long-open visits.
- Withdrawal synchronously notifies trackers, clears accessible Meta cookies and
  reloads the document, because removing a script cannot unload an SDK. A failed
  saved rejection is retained in memory and a non-identifying same-tab window.name
  latch so an old saved grant cannot silently reappear after reload. If browser
  storage is unavailable, other tabs/browsers may still need site-data clearing.
- The old unconditional Metricool loader is removed. Both providers require
  category consent and their own explicit build-time enable flag.
- Meta sends only explicit PageView events to the Café dataset. There is no
  noscript beacon, automatic advanced matching, purchase event or CAPI token.
  Automatic event configuration is disabled. There are no new credentials.
- The privacy notice changes are proposed text requiring review, not a legal
  compliance certification.

## Both flags must remain unset or false

`NEXT_PUBLIC_META_PIXEL_ENABLED`

`NEXT_PUBLIC_METRICOOL_ENABLED`

The code only enables a provider when its flag is exactly `true`. These public
Next.js variables take effect at build time. Preview builds also must keep both
off. No production environment setting is changed by this pull request.

## Restricted event scope and known limitation

Initial tracking allows only HTTPS on `cafe-sativa.com` and `www.cafe-sativa.com`,
on `/`, `/membership`, `/events`, and `/events/hit-em-release-party`. Query strings
and fragments are excluded, including UTMs and fbclid. Referrers must be empty,
an allowed Café public URL, or an HTTPS external origin with no path/query.
This is not yet a full advertising-attribution implementation.

The allowed-URL checks prevent explicit tracker startup and PageView dispatch
off-scope. They do not prove that an SDK already loaded cannot observe later
private-page navigation. Metricool has no verified stop API. Keep Metricool off
until its SDK behavior is verified or reliable teardown is implemented. The
same real-network review is required for Meta before activation. Do not claim
that mocked controller tests prove third-party SDK privacy behavior.

## Verification

Focused consent/controller tests, full TypeScript checking and a production
build run in the implementation workspace. See the pull request for final results.
The local snapshot includes all repository source/configuration text but excludes
public media binaries; those existing remote files are not changed by this patch.

A broad `node --test tests/*.cjs` invocation has six existing content/social test
harness failures. The same six failures reproduce on untouched main. No attempt
is made to repair unrelated workflows in this change.

The supported cloud browser could not reach the local development server
(`ERR_CONNECTION_REFUSED`), despite the server reporting ready. Therefore local
interactive and network browser assertions have not passed. A protected preview
or another supported test environment is required before release.

## Release gates

1. Approve the exact privacy disclosure and consent experience. Review the Meta
   and Metricool data handling and retention information for the actual account.
2. Verify Meta dataset owner, authorized users and ad-account association without
   changing unrelated portfolios or using a similarly named pixel.
3. Pass preview UI tests: keyboard focus/trap, Escape/Cancel, independent choices,
   mobile scrolling, repeated actions, reload, cross-tab withdrawal and BFCache.
4. Inspect actual network traffic/cookies before consent, after rejection, after
   each category grant, during delayed loading, after withdrawal and when entering
   private/account/checkout/chat routes. No provider request may precede consent.
5. Decide whether to keep Metricool disabled until private-route teardown is
   verified. Review ad URL attribution separately rather than silently weakening
   the current query-string restrictions.
6. Check the exact remote commit's CI, then authorize publication and enablement.
   Deploy with the desired flags only after the relevant gates are complete.
7. Verify production consent behavior, then confirm the Café dataset receives the
   intended PageView in Events Manager Test events. No purchase is needed.
