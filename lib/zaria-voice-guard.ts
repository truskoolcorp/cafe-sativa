/** Zaria's production voice must match the explicitly selected ElevenLabs flow. */
export const ZARIA_VOICE_CANON = Object.freeze({
  characterId: "zaria-solenne",
  flowId: "6ZSZ4Of8VsMAdKNvqZVj",
  nodeId: "node_a828f846-2936-4196-ab41-d748126a6b6f",
  modelId: "eleven_v4",
  voiceId: "5zneNR4v1Uw5AjIZ9Un4",
});
export function assertZariaVoiceCanon(input: {
  characterId: string; flowId: string; nodeId: string;
  modelId: string; voiceId: string;
}): void {
  if (input.characterId !== ZARIA_VOICE_CANON.characterId) {
    throw new Error("ZARIA_VOICE_CHARACTER_MISMATCH");
  }
  if (input.flowId !== ZARIA_VOICE_CANON.flowId ||
      input.nodeId !== ZARIA_VOICE_CANON.nodeId ||
      input.modelId !== ZARIA_VOICE_CANON.modelId ||
      input.voiceId !== ZARIA_VOICE_CANON.voiceId) {
    throw new Error("ZARIA_VOICE_CANON_DRIFT");
  }
}
