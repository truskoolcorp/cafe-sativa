import type {InternalProductionManifest} from './character-production-server-composition'
/** Exact owner-reviewed one-shot private canary. No client input, recurring policy,
 * credential, top-up or publication authority. Existing DB slot/budget must also
 * match and remain live; this manifest alone cannot create authorization rows. */
export const canaryAuthorization={
 key:"zaria-gallery-image-canary-20261114",
 digest:"01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3",
 startsAt:1794677700000,
 expiresAt:1794680700000,
 quoteCents:35,
 periodCapCents:40,
} as const
export function canaryWindowOpen(now=Date.now()){
 return Number.isSafeInteger(now)&&now>=canaryAuthorization.startsAt&&now<canaryAuthorization.expiresAt
}
export function reviewedCanaryManifest():InternalProductionManifest{
 const value={
  "configuration": {
    "engine": {
      "enabled": true,
      "provider": "heygen",
      "model": "avatar_iv",
      "characters": [
        "zaria-solenne"
      ],
      "maxVideoBytes": 36700160
    },
    "heygen": {
      "enabled": true,
      "aspectRatio": "16:9",
      "linkId": "link_6a56446b577c8191b3e9cc104dfe4321",
      "model": "avatar_iv",
      "bindings": [
        {
          "characterId": "zaria-solenne",
          "canonicalRevision": "3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8",
          "portraitSha256": "ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca",
          "voiceId": "5zneNR4v1Uw5AjIZ9Un4",
          "avatarId": "zaria-gallery-canonical-image",
          "audioBindingSha256": "66c46f07245f44e073a5bd129db1cc17e8892f1a985a0c7ffee0e675ca8a0488",
          "imageBindingSha256": "eb24fe04d1e6735a3f2fa8ae86e66f5448f31ec7ecc855cf2b9adeb0f82d1a34"
        }
      ],
      "mediaOrigins": [
        "https://files2.heygen.ai"
      ],
      "timeoutMs": 8000,
      "maxVideoBytes": 36700160
    }
  },
  "expectedHeyGenUsername": "d61468fdf18c4b478f27857337ddd1ea",
  "images": [
    {
      "characterId": "zaria-solenne",
      "canonicalRevision": "3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8",
      "portraitSha256": "ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca",
      "imageBytes": 2311086,
      "mime": "image/png",
      "audio": {
        "characterId": "zaria-solenne",
        "avatarId": "zaria-gallery-canonical-image",
        "voiceId": "5zneNR4v1Uw5AjIZ9Un4",
        "voiceModel": "eleven_v4",
        "canonicalRevision": "3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8",
        "portraitSha256": "ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca",
        "scriptSha256": "c178a82c59e5f414adbfb684f53b7b079e70aaadbc68e0276ac8397f142b52c0",
        "audioSha256": "713540eab3943024d3e998ee692f286fce70693f6df9bc6088ecd825a599c42b",
        "audioBytes": 146318,
        "mime": "audio/mpeg",
        "provider": "elevenlabs",
        "synthesisReceiptId": "uzGDp5HCorQQwo982hSH"
      },
      "approvedScene": {
        "imageSha256": "dc56e882a2beffac334927ecfe33b908568cbf2bc49065b0336259fca8fc784e",
        "approvalReference": "Sentinel_674253e2c98c8191bdfe85de68dbb52d"
      }
    }
  ]
} as const
 return {...value,exactScope:{key:canaryAuthorization.key,digest:canaryAuthorization.digest},configuration:{...value.configuration,engine:{...value.configuration.engine,now:Date.now}}}
}
