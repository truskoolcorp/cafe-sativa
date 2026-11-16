import {validateIncludedSpeechOperation,type IncludedSpeechOperation} from './character-production-included-speech-operation.ts'
/** Code-owned candidate. Not an exact-script owner approval, scene grant or publication approval. */
export const zariaLookAgainSpeech=Object.freeze({
 key:'zaria-look-again-speech-v1',
 script:'Before you read the title, take another look. What caught your eye first: the color, the shape, or the feeling? Bring your perspective to the Gallery at Café Sativa.',
 scriptSha256:'aa0a0dc1974dd91172c1ab41e98fded6f2434d45ce9403079e502dd4eeb80b7a',
 characterId:'zaria-solenne',
 voiceId:'5zneNR4v1Uw5AjIZ9Un4',
 modelId:'eleven_v4',
 portraitSha256:'ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca',
 maxDurationSeconds:30,
})
type CanonObservation=Readonly<{status:string;characterId:string;canonicalRevision:string;portraitAssetId:string;portraitSha256:string;voiceId:string;rightsStatus:string;voiceStatus:string;productionReady:boolean;observedAt:string}>
export type ReviewedZariaSpeechBinding=Readonly<{canon:CanonObservation;authorizationRef:string;expiresAt:number}>
/** Only deployment-owned reviewed values enter here, never request data.
 * Observation freshness is reviewed before deployment; execution rechecks exact
 * live canon via createFiniteIncludedSpeechHandler, not this historical object. */
export function bindReviewedZariaSpeech(binding:ReviewedZariaSpeechBinding):IncludedSpeechOperation{
 const c=binding.canon
 if(c.status!=='observed'||c.characterId!==zariaLookAgainSpeech.characterId||c.portraitAssetId!=='473df9fd-b48c-4f01-a89a-499de631b954'||c.portraitSha256!==zariaLookAgainSpeech.portraitSha256||c.voiceId!==zariaLookAgainSpeech.voiceId||c.rightsStatus!=='approved'||c.voiceStatus!=='canonical'||c.productionReady!==true||!Number.isFinite(Date.parse(c.observedAt)))throw Error('reviewed_canon_unverified')
 const operation=Object.freeze({...zariaLookAgainSpeech,canonicalRevision:c.canonicalRevision,authorizationRef:binding.authorizationRef,expiresAt:binding.expiresAt})
 validateIncludedSpeechOperation(operation)
 return operation
}
/** No route is registered by this module. Null binding cannot open a runtime.
 * Stable key is deliberately not caller-configurable, including after expiry. */
export function composeReviewedZariaSpeech(binding:ReviewedZariaSpeechBinding|null,factory:(scope:IncludedSpeechOperation)=>(req:Request)=>Promise<Response>){
 if(binding===null)return async(_req:Request)=>Response.json({status:'not_configured',qaApproved:false,publicationApproved:false},{status:503,headers:{'Cache-Control':'private, no-store'}})
 return factory(bindReviewedZariaSpeech(binding))
}
