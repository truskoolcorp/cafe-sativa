# Dormant exact canonical image + existing audio adapter

Official schema inspected: https://developers.heygen.com/reference/create-video.md
`CreateVideoFromImage` uses `type:image`, nested `image:{type:url,url:...}`,
and `audio_url`. It forbids extra properties and does not list an engine field.
This adapter therefore omits engine on the wire and permits only the documented
Avatar IV default internally. It never sends a guessed registered avatar ID,
native voice ID, image_url field, new script synthesis or a model upgrade.

The existing avatarId field is a trusted logical identity label in this mode,
not a claimed HeyGen registered look. New imageBindingSha256 discriminates the
mode in the durable provider-binding revision. Exact canonical revision, portrait
hash, image byte count/MIME and existing audio receipt digest are bound together.
Legacy registered-avatar revisions remain unchanged. Use the dedicated image
composition, not the native look verifier; it verifies the actual account username
and exact private bytes before claim. Existing runtime canonical checks still apply.

Private image source is the existing cafe-sativa-characters bucket, exact
production-inputs/<sha256>.png or .jpg, private max10MiB metadata with the exact existing allowlist PNG/JPEG/WebP/JSON.
JSON is existing registry data, never a permitted selected image: exact PNG/JPEG
proof, hash and header are required. No bucket policy is broadened.
Audio remains character-production-audio/audio/<sha256>.mp3 or .wav. Both are
bounded read/hash checked and re-read before five-minute signing; no public URL,
new bucket, policy, upload, credential copy or direct generation route is added.
Signing does grant the provider temporary access to those exact approved assets.
Token expiry before provider retrieval remains an unknown/failure reconciliation
case, never permission for automatic recreation. Header checks do not replace
perceptual face/voice QA. Existing audio must have trusted provenance, not a
client-invented synthesis receipt.

Activation still requires exact cost quote/approval, durable slot/budget and
provider-binding revision, actual account and byte readback, current authority,
and existing engine claim-before-write wiring. This tranche makes no provider
calls in production and does not install rows, grants or a schedule. Avatar IV
may reject the source image or render imperfectly; inspect the private result
before any approval/publication. One canary is not recurring automation.

## Reviewed room scenes versus identity portraits

`approvedScene` optionally binds a distinct rendered `imageSha256` and a reviewed
`approvalReference`. The canonical `portraitSha256` stays the live character's
primary identity portrait and must still agree with the audio and current canon.
The scene hash controls private object path and byte readback only. A v2 scene
binding digest includes identity, canonical revision, scene bytes, approval reference,
and exact audio proof. Changing any requires a new reviewed binding/slot digest.
Legacy portrait-only bindings retain their v1 digest unchanged. Nested scene proofs
are snapshotted to prevent post-construction changes. This is not image approval
inference: only trusted reviewed deployment configuration supplies the reference.
No registry image replacement, automatic enrollment, paid call or activation occurs.
