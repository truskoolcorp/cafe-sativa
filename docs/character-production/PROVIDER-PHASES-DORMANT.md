# Dormant bounded image-provider phase correction

No live manifest, deadline, schedule, ledger or flags change here. The original
canary remains the reviewed 8-second behavior until separately changed.

An optional exact code configuration separates read-only image/audio validation
and signing from the paid POST. Prepared closures are single-use, short-lived and
consume themselves before dispatch, including a failed/aborted POST. Each phase
has a bound, and preparation + submission or status + download must fit a total
ceiling no greater than 30 seconds. The existing global worker cancellation still
applies. Existing configurations use the old behavior; native/audio-only
transports cannot silently opt into an unsupported preparation protocol.

The direct image client uses the explicit submit timeout instead of silently
clamping that phase back to 8 seconds. No larger timeout means approval to retry.
A timed-out paid request remains uncertain and its claim must never be reset.

This patch does NOT solve durable receipt observability or claim paid requests
cannot time out. A separate reviewed protocol must preserve a valid original task
ID even when subsequent response qualification fails, without accepting that
response as output QA. Never record signed media URLs, credentials or raw errors.
