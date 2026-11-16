# Dormant finite enrollment HTTP boundaries

Three independent GET routes exist under `/api/internal/character-production/enrolled/`:
`plan`, `work`, and `qa`. There is no scheduled cron registration in this change.
Each requires the existing cron authorization, rejects query parameters and does
not accept candidate/enrollment/provider input. The phase is fixed in server code.

The code-owned runtime binding is explicitly null. Authorized requests return
503/unconfigured with no database or provider access, regardless of environment
flags. No synthetic candidate or old canary is substituted. Connecting the real
runtime requires a subsequent reviewed code change with finite manifest, actual
media evidence and the scoped capability. Its phase-level flags, limits and SQL
checks still apply; this HTTP dispatcher does not replace those controls.

The planner result is reduced to status only; exceptions are held without raw
diagnostics. Worker and QA retain their reviewed bounded response handlers.
Private QA ingestion still is not audiovisual/watermark/publication approval.
Route maxDuration60 allows the existing phase budgets; it is not a new provider
retry or a distributed lock. No credentials, permissions, flags, cron schedule,
enrollment or provider call is created here.

Seven local boundary tests cover absent binding, unauthorized/method/query/abort
rejection before runtime, exact phase dispatch, error handling and static dormant
route composition. These are not end-to-end production generation evidence.
