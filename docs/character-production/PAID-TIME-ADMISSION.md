# Paid-write time admission

Actual production POST dispatch now requires an inherited tick budget. The guard runs at the fixed provider network boundary, after all asynchronous account/canonical/source preparation, immediately before underlying fetch. It reserves the complete configured submit ceiling, two 8-second backend writes (original-ID evidence and submitted receipt), plus a one-second margin. Both wall and monotonic elapsed time and tick cancellation are checked. No budget, insufficient time or clock rollback means no POST.

This does not add authorization, retries, recurring spend or new manifests. A denied POST leaves the existing unique reservation held; it is not automatically retried or refunded. The time allowance is admission, not a guarantee of provider cancellation or database availability. A second paid canary requires separate exact slot/budget authorization and read-only timing validation. The original canary is not replayed.
