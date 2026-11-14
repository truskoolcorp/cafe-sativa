# Dormant trusted planner server composition

New composition joins the existing scheduler, exact policy RPC reader, validator,
and verified private image/audio binding reader. Server wrapper uses fixed GLYPH,
existing private Supabase media sources and existing direct HeyGen account GET.
It exposes no route/cron, signs no URLs, generates no content and publishes nothing.
Reviewed code manifest is snapshotted; no candidate/actor is read from HTTP input.
An invocation has a finite deadline and aborts its network lifetime when finished;
late actor resolution cannot start a policy or planning write.

Planner client capability is explicitly separate from the service storage client.
No service-role planner permission is assumed or granted. A missing reviewed narrow
planner client fails closed. Actor resolution is mandatory, fresh, server-authenticated,
and may return null if unattended authority is unsupported. No actor is invented.

Tests: 11 new composition tests pass; focused strict TypeScript passes including
server wrapper using existing local Supabase package resolution. No full Next build
claim. No provider/database live execution was performed.

## Still missing for activation

- Reviewed narrow planner RPC capability; ordinary service client cannot substitute.
- Genuine authenticated unattended actor resolution (not merely an arbitrary UUID).
- Actual current reviewed candidate records and image/audio/quote/rights manifests.
  No expired canary or synthetic fixture is selected by this code.
- Finite owner policy enrollment, quote/wallet evidence, and complete scheduler route
  and deployment review. The manifest candidate list is not a content generator.
- End-to-end successful generation, media/voice/scene/watermark QA and publication
  receipts. These modules only establish planning composition, not live automation.
