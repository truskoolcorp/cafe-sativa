/**
 * Café Sativa editorial/hosting responsibility model.
 * This is a role policy for recommendation drafts, not authorization to render or publish.
 * GLYPH remains the source of truth for character-specific names, likeness, voice and canon.
 */
export const CAFE_SATIVA_EDITORIAL_ROLES = Object.freeze({
 owner: {displayName:'Keith',authority:'owner_final_approval'},
 analyst: {system:'Anya / OpenClaw',responsibility:'evidence_based_analysis_and_recommendation',publicHost:false},
 concierge: {characterName:'Laviche',responsibility:'primary_venue_hostess_and_guest_concierge'},
 specialists: {
  stage: ['Ahnika'],
  content_and_culture: ['Ginger'],
  cigar_lounge: ['Don Aurelio'],
  kitchen: ['Chef V']
 }
} as const)
export type RecommendationEvidence = {
 source:string
 observedAt:string
 finding:string
 metric?:number
}
export type RecommendationDraft = {
 title:string
 venueArea:string
 whyNow:string
 evidence:RecommendationEvidence[]
 confidence:'low'|'medium'|'high'
 hostCharacterIds:string[]
 concierge:'Laviche'
 status:'suggested'
}
/** No evidence means no automated recommendation, regardless of theme popularity. */
export function assessRecommendationDraft(draft:RecommendationDraft){
 const issues:string[]=[]
 if(!draft.title.trim()||!draft.whyNow.trim())issues.push('missing_analysis')
 if(draft.evidence.length===0)issues.push('missing_evidence')
 if(draft.evidence.some(x=>!x.source.trim()||!x.finding.trim()||!Number.isFinite(Date.parse(x.observedAt))))issues.push('invalid_evidence')
 if(draft.concierge!=='Laviche')issues.push('concierge_role_conflict')
 if(draft.status!=='suggested')issues.push('approval_required')
 return {eligibleForReview:issues.length===0,issues,mayGenerate:false,mayPublish:false}
}
