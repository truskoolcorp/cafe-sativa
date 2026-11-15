# Empty POST adapter correction
Observed live probe returned unsupported (400); its specific failing predicate
was not logged. Do not assert that its actual root cause is proven.

Local reproduction uses installed NextRequestAdapter.fromNodeNextRequest, not
only a plain Web Request mock. For a Node POST with Content-Length 0 and an empty
Readable, the adapter gives NextRequest a non-null body stream. The previous
req.body !== null guard rejects that legitimate empty POST. This proves a real
adapter compatibility defect, not the exact live cause.

Both protected probe and finite speech handlers now require stream EOF rather
than null identity. Method, origin, query and authentication remain unchanged.
The helper buffers no body, rejects the first nonempty chunk (even whitespace),
allows at most eight empty chunks, rejects errors/aborted/disturbed streams and
has a 500 ms maximum read window. Cancellation is not awaited. Content-Length
is not trusted as proof. No body is decoded or used as operation scope.
A missing/null stream still counts as empty. New safe body rejection reason is
nonempty_or_unreadable_body, with no content or credentials disclosed.

Tests use installed actual Next adapter for both empty and nonempty POSTs and
exercise both handlers only against mocked service boundaries. No live probe,
new attempt UUID, provider call or production setting was performed.
