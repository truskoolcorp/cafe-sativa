# Durable text concierge compatibility and recovery

Local implementation only. Do not enable or deploy this flow until the reviewed migration, synthetic database validation, policy configuration, writer coordination, privacy/deletion lifecycle, and rollout approvals are complete.

`CONCIERGE_DURABLE_MODE` defaults to `off`. `on` enables ledger admission; any other nonempty value fails closed. The browser reads the uncached `GET /api/concierge/status` capability before sending. In off mode, the previous page-local guest-session fallback remains available if browser storage is blocked. In on mode, the exact original body and request UUID must be durably retained before transmission. Existing retained work is never silently discarded or converted into legacy work.

Browser requests carry `X-Concierge-Durable: 1` for durable sends/recovery or `0` for legacy sends. The server rejects a mode mismatch before any paid work or ledger admission. This fences configuration changes between the capability read and POST. External legacy mall callers without this header remain supported, including opaque non-UUID sessions; without an original client request UUID they cannot recover a first lost response reliably.

An explicit status check can return `202 recovery_required: true` for an expired reservation or a missing ledger key while mode is on. The browser may then POST only the identical stored body and UUID. A delayed original admission and that replay compete for the same atomic ledger key; only an unambiguous fresh admission may dispatch. Status itself never dispatches. Missing, disabled, or unavailable status while mode is off never grants replay. Unknown dispatches remain charged and are never retried at the provider.

## Rollback is a drain, not a flag flip

Do not merely set mode off while durable work is outstanding: that reopens the legacy quota path. Pause new admissions through the reviewed ledger policy while keeping durable workers, status, and completion available; drain reservations and reconcile dispatched/uncertain work using verified terminal evidence. Only then switch workers to legacy mode if rollback is approved. Preserve the ledger and replay/tombstone horizon. Time passing, an aborted browser request, or a provider timeout is not evidence that provider execution ended.

Validation is mocked route/client I/O plus local type checks; it does not establish production database concurrency or rollout safety.

Durable browser requests also carry `X-Concierge-Requester` with the retained request's expected `user:` or `guest:` identity. Before any quota, memory, admission, or status RPC, the server compares that expectation with verified authentication and the normalized original session. The hint cannot confer authority. Missing or mismatched hints on fenced browser requests return `409 requester_changed`, retaining the original request for its original identity. This closes the window where another tab changes login before this tab receives the auth callback.

Pending browser work uses per-request keys rather than one overwritable slot per account/host. Concurrent tabs may discover more than one unresolved request; each retains its original body and can be recovered separately. While definitively signed out, the browser may recover retained guest requests for the current host from the same browser, including a guest session created by a racing first-use tab. Recovery uses that record's original session and requester fence, never a signed-in user's identity. New sends remain blocked until unresolved work is handled. Malformed retained records fail closed.
