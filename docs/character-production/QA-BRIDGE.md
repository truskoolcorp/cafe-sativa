# Private QA ingestion

The bridge consumes a server-enrolled job-to-existing-draft target. It verifies the immutable generation slot, exact character and script, matching untouched/unapproved draft, and prepared destination. It binds the original microsecond timestamp string, promo ID, destination bucket/path, video hash and byte count through prepare and commit, rejecting target reassignment.

Private immutable content-addressed bytes are hash-checked, copied with no overwrite, read back and verified before a locked SQL commit updates only the draft's video path and timestamp. It does not set voice/video/publication approvals or create delivery plans. Existing draft guards remain in force and can invalidate review or reject frozen attempts. Exact receipts make repeated commits idempotent.

Storage download uses bounded streams, abort and redirect:error; bucket metadata must be private. SDK compatibility is tested against the repository-installed dependency. Upload/getBucket cancellation is limited by their SDK interface: timeout does not prove no side effect. Unknown writes stay held for readback reconciliation.

The optional lazy runner reads at most five enrolled entries, validates the queue and handles each independently. It does not enroll targets or schedule runs. Repeated held queue heads can require operator repair; no automatic quarantine is claimed.
