# Current Café pipeline entry (dormant)

This code connects existing preparation, original speech receipt verification, first admission/planning and selected generation/collection/private-QA factories. It does not configure or schedule production.

The server selects only the current stored occurrence. HTTP callers cannot provide a phase, manifest, draft, actor or credential. The route is authenticated and deliberately unconfigured. A separately reviewed code-owned baseline is required. The route composes the concrete guarded narrow opener only after that baseline is present. Static old canary images/bindings are rejected.

## Phase contract

- prepare: existing original text/speech operation, with its durable claims and separate budgets.
- admit: first verify the exact original private audio receipt using saved text identity. A speech claim alone is not completion evidence. Unknown/missing receipts hold without re-synthesis. Only verified receipt permits the existing admission/planning factory.
- work: require current planned draft generation membership and exact immutable accepted manifest. Never use expired admission.active as permission to renew a scope. Existing selected engine chooses one generation, collection or private-QA phase. No eligible work reports waiting, not done.

Entry timeout is 85 seconds, Vercel route ceiling90. Original operations continue to be tracked after timeout response until settled; failed drainage keeps local admission held. Selected generation keeps the existing45-second budget and native spending checks. Child flags, durable claims, native authority and deadlines remain in force.

The master entry flag controls admission and context checks, not universal immediate native cancellation of every child. The supplied capability opener must check abort/revocation at its native transport and provide a non-closing settlement drain; children retain their own stage flags. There is no implicit service-role RPC fallback in the entry.

## Source-only access proposal

New character_production_pipeline_context() is owner-only with no runtime grants. It reuses existing preparation and first-admission records. Calling preparation_context may reserve an immutable original occurrence under existing enabled policy; it cannot invent policy or reset claims. cs_cafe_generation_membership is owned by the same production owner, so this call adds no cross-owner grant. A future runtime EXECUTE grant must be reviewed against actual installed roles/indirect paths.

The existing preparation/admission factories still need their already-proposed narrow backend grants and valid owner provisioned configuration. This file installs none.

## Remaining production prerequisites

Code-owned baseline/account/model/media-origin limits; current lane/image/quote/voice bindings; separately authorized text/speech budgets; existing HeyGen wallet cap20USD/month with no topups; reviewed capability installation; public-media/semantic QA; publication configuration and finite semantic lease or authorized per-occurrence lease source; and a separately reviewed schedule. Public QA is not private ingestion. No end-to-end success is claimed until a genuine real run succeeds.

Concrete opener uses the existing server Supabase client in place, with an RPC allowlist and exact enrollment/selection pin. It exposes only identity-derived private speech paths and receipt-bound audio reads. Future grants to service_role must disclose and review existing indirect role membership paths (including Storage admin where present); TypeScript scoping does not erase database role access. No such grant is applied here.

## Hosted task lifetime
The actual route registers the original task plus child/receipt/network drainage synchronously through `@vercel/functions` `waitUntil`, pinned to 3.11.3. Registration occurs before any capability opens. A failed registration aborts without opening work. An early 85-second response does not detach the original drain. Vercel's 90-second `maxDuration` still caps both foreground and retained work; platform termination is never proof of provider failure or permission to retry an unknown original claim. This is supported for Next 14, without using Next 15 `after()`.
Reference: https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
