// Fixed reviewed observations of exact original bytes, not a general automatic classifier.
export const zariaOriginalObservations = [
  {
    "check_name": "mp4_integrity",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. Independent SHA256 and byte count matched exact original output. ffprobe: H.264 video, AAC audio,1920x1080,25fps,7.98s. Full ffmpeg decode to null returned no errors."
  },
  {
    "check_name": "canonical_likeness",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. Compared all199 frame thumbnails in four sheets against approved Gallery composite dc56e882a2beffac334927ecfe33b908568cbf2bc49065b0336259fca8fc784e viewed at full resolution. Persona appearance and scene retained. This is visual similarity to approved fictional persona input, not biometric identification. Live canonical revision must be revalidated before persistence/publication."
  },
  {
    "check_name": "canonical_speech",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. Recovered provider input audio SHA713540eab3943024d3e998ee692f286fce70693f6df9bc6088ecd825a599c42b matched146318bytes. Saved source provenance binds approved script to Bree5zneNR4v1Uw5AjIZ9Un4/eleven_v4. Independently decoded output/input mono16kHz: aligned waveform correlation0.9864640578127721 over7.957375s,lag368samples. Saved offline ASR matches intro with phonetic name variation. This establishes source audio preservation, not an independent pronunciation judgment; live canonical voice proof remains required."
  },
  {
    "check_name": "lip_sync",
    "result": "needs_review",
    "evidence": "AI-assisted inspection, not personal owner review. Frame sheets show changing mouth poses but do not prove time-aligned phoneme/viseme synchronization. Need synchronized full clip playback or independently validated temporal alignment assessment. Waveform correlation alone does not prove lip sync."
  },
  {
    "check_name": "visual_text",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. All199 full-frame thumbnails inspected plus enlarged lower strip sampled1fps: no added captions, claims, garbled overlay text or third-party titles observed. No claim of exhaustive OCR."
  },
  {
    "check_name": "rights",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. Authenticated production Café reference read by coordinating agent at2026-11-14T19:38:55.636Z: live=true, unique zaria-solenne, exact prior asset473df9fd-b48c-4f01-a89a-499de631b954 and portrait ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca, rights_status=approved, requires_rights_consent=false, voice5zneNR4v1Uw5AjIZ9Un4 canonical, production_ready=true, no blockers. Canonical context retained Oct10 Gallery host identity. Existing owner-authorized scene and synthesis provenance bind exact inputs. This observation attributes the live read to coordinating agent; a whole-row revision recomputation was not independently performed here. Downstream loader must still revalidate live canon at scheduling time."
  },
  {
    "check_name": "duration",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. Full output duration7.98s matches intended approximately8s intro; video7.96s/audio7.98s. Final draft must explicitly bind this actual duration, not an inherited30s default."
  },
  {
    "check_name": "brand_safety",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. Observed Gallery welcome imagery and supplied intro transcript contain no explicit content, harmful instruction, sensitive disclosure, unsupported product/medical claim or paid offer. Limited to exact clip, not future caption/collaborator metadata."
  },
  {
    "check_name": "third_party_watermark",
    "result": "pass",
    "evidence": "AI-assisted inspection, not personal owner review. All199 frame thumbnails inspected in four contact sheets; enlarged lower strip sampled1fps. No third-party watermark observed. AI-assisted visual review, not a perfect automated detector. Owned ecosystem marks are allowed; changed bytes need new review."
  }
] as const
