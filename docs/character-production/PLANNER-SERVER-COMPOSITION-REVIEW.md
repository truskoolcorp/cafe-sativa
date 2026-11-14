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

Tests: 20 new composition tests pass; focused strict TypeScript passes including
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

## Persisted reconciliation
The immutable manifest is limited to 32 candidates. Each eligible candidate is read through the existing exact `character_production_planned_draft(uuid,jsonb,text,text)` boolean RPC using its draft ID, frozen slot, current computed digest and theme. Only literal true skips a candidate; null, errors or malformed results stop the tick before actor resolution or a planning write. A fresh process therefore skips matching persisted active draft/slot/digest/theme bindings. This boolean does not compare the candidate policy ID/revision or scheduled time, and is only a deduplication hint, not proof that the full candidate or its publication is complete. There is at most one planning write per tick and no retry. The future narrow planner capability must explicitly permit this reconciliation RPC as well as the policy/planning RPCs; no grants are added here.

Limit: that existing boolean returns false for disabled, conflicting or expired records as well as absent records. False is not proof that a draft is unused; the planner SQL remains responsible for rejecting conflicting records. Such a first candidate can block later candidates and requires reviewed reconciliation, not an automatic bypass or cadence skip.
