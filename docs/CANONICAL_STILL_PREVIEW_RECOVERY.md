# Canonical-locked, no-provider venue preview recovery

Scope: the five earlier rejected venue rooms `stage`, `kitchen`, `gallery`, `cigar_lounge` and `community` only. No paid re-generation, invented backgrounds, camera pans or geometry changes.

1. Select **the current, explicitly approved** `cs_canonical_assets` record for the exact room: `active=true`, owner `approved_by` and `approved_at` present, and known SHA-256. Never select an unapproved reference, an archived revision, the rejected video, or a placeholder image.
2. Obtain the original canonical **image bytes** via trusted private asset storage in an isolated workspace. Independently compute their SHA-256 and compare to the registry's digest. Do not attach provider API secrets or download from arbitrary submitted URLs.
3. With local `ffmpeg` and Python 3, run:
   ```sh
   python3 tools/render_canonical_still_preview.py --room stage \
     --approved-local-image /secure/workspace/current-approved-stage.png \
     --approved-sha256 YOUR_64_CHARACTER_APPROVED_DIGEST \
     --output /secure/workspace/stage-qa-pending.mp4
   ```
   The tool emits a receipt containing input digest and output digest. The resulting artifact is **not approved for publication**.
4. Visually compare every frame with the approved master. The master image must remain fully visible; only fit/padding, no cropping, perspective reconstruction, new venue geometry, people, or logos. The five-second clip has no generated or licensed audio.
5. Do not overwrite historical failed jobs, erase rejection reasons, change canonical masters, or automatically submit any provider task. Store the QA-pending artifact privately, link provenance to a **new job** with a unique idempotency key, then run the existing owner QA/editorial approval/release gates. The old rejected tasks remain permanent audit evidence.
6. After explicit media QA approval and editorial release, optionally permit the existing delivery pipeline to use the replacement artifact. No direct promotion occurs in this PR: the production clip-job schema expects a verified, versioned rendering policy and canonical job association. That integration requires separate reviewed code and tests.

**Why this fallback is deterministic:** the only visual pixels in the original venue composition derive from the exact approved still. The output is a motionless five-second video rather than a model-invented cinematic camera move. Encoder bytes may differ with ffmpeg versions; the input SHA must always match the registry and the output SHA is stored as a QA receipt.

**Cost:** no external generation credits or new SaaS subscriptions. Local CPU encoding and existing storage still use resources. Never spend money or publish content as part of this recovery procedure.
