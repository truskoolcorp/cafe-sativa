# Dormant receipt evidence capture

Opt-in `EngineConfig.captureReceipts`, absent from the live manifest. No activation, provider call, credential, output approval, recurring spend or grants in this patch.

Before claim the provider/store must advertise capture. After the unique claim, a NULL-task RPC preflight proves installed capability and current exact authority; missing capability holds the reserved slot without a paid POST. The engine revalidates authority after preflight.

The direct success-envelope identity extractor runs before output-format/resolution qualification. Only a syntactically valid documented pending creation ID is recorded, under original key/token/digest. Evidence persistence does not qualify the output or promote unknown work. The full receipt must match that identity and remain in deadline before submitted transition. Any decoder/storage/deadline failure holds with no retry/refund/reset. Evidence is retained after expiry; no collection of unknown records. The SQL has no grants and must be separately installed/reviewed before opt-in.

This cannot recover an ID from a network timeout with no returned success envelope, and does not guarantee receipt capture if storage is unavailable. The original paid canary remains manually recovered pending QA; no replay is part of these synthetic tests.
