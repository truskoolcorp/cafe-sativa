# Dormant enrolled runtime composition

No route, cron, enrollment, flag, provider call, SQL apply or grant is added.
`createInternalEnrollmentRuntime` requires a finite reviewed planner enrollment,
production image/audio manifest and explicit scoped planner client capability.
It derives exact job keys/digests from those candidates, not request data.

Planner, worker and private QA ingestion remain independent bounded calls.
Worker uses the existing engine/coordinator with the enrolled SQL read adapter;
its transport factory is explicitly supplied and has no broad-queue fallback.
The legacy canary call signature/behavior is unchanged. Worker and QA switches
are false unless explicitly set true; this patch does not set them.

QA discovers at most one enrolled draft, materializes its existing reviewed
binding, and invokes the existing hash-verifying private bridge. A successful
`ingested` result is NOT voice, lipsync, watermark or publication approval.
No social delivery is wired here. Existing reviewed media plus perceptual QA,
policy, grants and finite enrollment remain deployment prerequisites.

QA admission is process-local, not a distributed lock. SQL identities and
insert-once storage provide durable reconciliation; a timeout holds local
admission until outstanding task/network settlement. No provider retry exists.
Operational enrollment revocation and admin removal retain the separately
documented distinction; this factory does not strengthen raw SQL claim rules.

Tests exercise actual enrolled RPC routing and real private QA bridge using fake
SDK/storage transports. They do not prove live provider generation or live
Storage authority. Server composition is strict-TypeScript checked.

The worker manifest is deep-copied at factory creation (HeyGen bindings, origins,
phase limits, image/audio bindings and engine characters). Only the reviewed
engine clock function is retained by reference. Caller mutation regression is
covered separately; no caller-owned mutable configuration remains shared.
