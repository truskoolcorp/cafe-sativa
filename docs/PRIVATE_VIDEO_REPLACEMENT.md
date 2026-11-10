# Private replacement review
Existing content admins can replace a pending-QA draft's MP4 from the content-review panel. This does not grant any new role or public access and never approves, schedules, dispatches or publishes content.

Upload is raw video/mp4, capped at3MiB even without Content-Length, with a10-second body-read deadline. The existing local FFmpeg binary receives a fixed local MP4 input, network protocols excluded, decoder pixels capped at1920x1080, individual allocation64MiB, decoder threads2, filter threads1, process timeout25seconds. It outputs a silent, fitted1280x720@24fps preview of at most5seconds. Unsupported/corrupt inputs fail closed.

The server requires same origin and authenticated server-controlled cafe_sativa_admin metadata. It checks the current policy, pending-QA status, exact job revision and unique approved canonical snapshot before encoding, then rechecks the canonical master before uploading. It writes an immutable random UUID MP4 into the existing private content bucket, with durable custom object metadata in the same upload request. The metadata records actor, prior source, input/stored SHA256, canonical snapshot, normalization and unapproved/unpublished state.

A compare-and-set attaches the new media only while job revision, old output and pending-QA status still match. Old media remains intact. Upload failures or CAS losses may leave unreferenced private objects; these are deliberately not deleted automatically, because an uncertain database response could have linked the object. No object URL is logged or returned by this endpoint. Existing authenticated review supplies the normal short-lived private preview URL.

Accuracy review now requires the exact media path and job revision shown to the reviewer. UI resets checked assertions when media/revision changes. After replacement, review all accuracy checks again; then separately review website caption/release time and social destination. No existing approval is inherited.

Verification: bounded-body and API authorization/race regression tests, canonical review snapshot tests, TypeScript, actual local FFmpeg normalization. Authenticated browser QA and deployed storage flow still require validation before reporting live success.
