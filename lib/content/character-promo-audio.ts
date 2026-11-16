type PromoAudioDraft = {
  id: string
  audio_asset_path?: string | null
  video_asset_path?: string | null
  voice_approved_at?: string | null
}

type PromoSpeechObservation = {
  promo_id: string
  video_sha256: string | null
  check_name: string
  result: string
}

/** Evidence is not final approval and does not independently verify a voice identity. */
export function characterPromoAudioStatus(
  draft: PromoAudioDraft | undefined,
  observations: readonly PromoSpeechObservation[],
) {
  const videoSha256 = draft?.video_asset_path?.match(/\/([a-f0-9]{64})\.mp4$/)?.[1] || null
  const speech = videoSha256 && draft
    ? observations.filter(q => q.promo_id === draft.id && q.video_sha256 === videoSha256 && q.check_name === 'canonical_speech')
    : []
  // The ledger has one row per check/hash. Reject conflicting duplicate evidence defensively.
  const embeddedSpeechRecorded = speech.length > 0 && speech.every(q => q.result === 'pass')
  const hasAudioEvidence = Boolean(draft?.audio_asset_path) || embeddedSpeechRecorded
  const voiceApproved = Boolean(draft?.voice_approved_at)
  return { videoSha256, embeddedSpeechRecorded, hasAudioEvidence, voiceApproved, ready: hasAudioEvidence && voiceApproved }
}
