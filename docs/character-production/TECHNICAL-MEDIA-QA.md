# Dormant technical evaluator

`evaluateTechnicalMedia` accepts only exact bounded video/audio bytes and SHA256s from a trusted private-storage caller, plus trusted absolute executable paths and cancellation signal. It creates private temporary files, invokes real ffprobe and full ffmpeg decode, compares mono 16k PCM hashes, and joins process close before cleanup. Six local synthetic tests use real tools. It does not persist observations or approve publication. PCM equality is audio preservation evidence, not identity/pronunciation proof. Actual durations below eight seconds are held, never rounded.

## Not yet production-composed

Current application ships @ffmpeg-installer/linux-x64 but no ffprobe. Next tracing includes neither binary for enrolled/private QA routes. Those routes must not be enabled assuming tools exist. A reviewed Node/Linux worker needs executable provenance, binary tracing, isolated execution with bounded memory/CPU and no network, sufficient tmp storage, and measured full-decode latency inside its deadline. Native tool timeout is not a substitute for OS memory isolation. Input bytes must come from current exact selected snapshot and private original receipt readers, not user JSON; existing createPrivateRenderedAudioSource.read can supply original audio without signed URLs. No new storage privilege or reviewer identity is granted here.

## Missing perceptual reviewer contract

Input: immutable output SHA, original audio SHA and verified synthesis receipt, saved script hash/text, current approved persona/scene references and rights revision; exact frame/time coverage and full clip audio/video. Output: hash-bound per-check pass/fail/needs_review, assessor/version, thresholds, timestamps, measured coverage, evidence and real provider receipt. Missing frames, stale canon, changed bytes, unavailable model, uncertain result or truncated processing yields needs_review. Never inherit old canary observations.

ASR must compare actual rendered speech with stored script and identify uncertain pronunciation. Voice provenance plus preserved PCM supports source continuity, not perceptual quality. Visual assessment must inspect actual rendered likeness/text/brand content; watermark clearance cannot derive from a clean provider setting or isolated sampled frame. Temporal lip-sync requires synchronized clip review or an independently validated temporal model. Rights come from current approved rights records, never an inferred model pass.

Any paid ASR/visual/temporal model requires its own approved budget and bounded no-retry request/receipt path, separate from HeyGen's cap and existing text-only semantic lease. The present code calls no provider. Observation persistence needs a separately reviewed scoped capability with truthful automation attribution, not an impersonated owner identity. Final content/publication authority remains separate from technical results.

## Concrete selected integration (dormant)

The selected recurring QA adapter now invokes the trusted selected-private evaluator after existing materialization and before bridge ingestion when CS_CHARACTER_TECHNICAL_QA_ENABLED is explicitly true. Default remains off. Failure/revocation prevents ingestion; observations are returned by the evaluator, not persisted as approval. No durable reviewer-result writer is introduced, so this is not end-to-end QA clearance. The selected-binding proposal extends only the existing current-token reader to QA; no grants or installation are included.

The official npm ffprobe linux-x64 package is pinned at5.2.0 with lock integrity; CI tests the exact ffmpeg4.1.0 and ffprobe5.2.0 binaries. ffprobe postinstall is only chmod u+x, repeated explicitly in ignore-scripts CI. Actual packaged-binary tests pass. PCM comparison may differ across decoder versions; mismatch stays evidence requiring review, never canonical-speech approval. Next tracing includes both binaries on QA entry routes. Deployment binary presence, memory isolation, latency and live capabilities still need verification before activation.
