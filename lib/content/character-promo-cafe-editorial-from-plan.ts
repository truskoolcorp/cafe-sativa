import type {CafeCollaborator} from './character-promo-cafe-metricool'
import type {CafeEditorialMetadata} from './character-promo-cafe-sources'
import {initialCafeEditorial} from './character-promo-cafe-initial-editorial'
import {normalizePromoDatabaseTime} from './character-promo-time'
/** Minimal proposed editorial snapshot from existing server records. Does not
 * create approval, rewrite a caption, synthesize QA, or add collaborator claims. */
export function cafeEditorialFromPlan(plan:Record<string,unknown>,draft:Record<string,unknown>,savedEditorial?:unknown,verifiedCollaborators:readonly CafeCollaborator[]=[]):CafeEditorialMetadata {
 const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
 if(!uuid(plan.id)||!uuid(draft.id)||plan.promo_id!==draft.id||plan.character_id!==draft.character_id||draft.actual_social_account!=='metricool-brand:7605217')throw Error('Exact Café source identity required')
 if(plan.network!=='facebook'&&plan.network!=='instagram')throw Error('Unsupported Café destination')
 if(plan.account_id!==(plan.network==='facebook'?'105363501666032':'cafesativainc'))throw Error('Unverified Café account')
 if(typeof plan.caption!=='string'||!plan.caption.trim())throw Error('Existing caption required')
 const scheduledAt=normalizePromoDatabaseTime(plan.scheduled_at as string,true)
 if(!scheduledAt||typeof draft.character_id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(draft.character_id))throw Error('Exact source time/character required')
 const path=typeof draft.video_asset_path==='string'?draft.video_asset_path:''
 const match=path.match(new RegExp('^character-promos/'+draft.character_id+'/'+draft.id+'/([a-f0-9]{64})\\.mp4$'))
 if(!match)throw Error('Final private media identity required')
 const saved=savedEditorial===undefined?undefined:initialCafeEditorial(savedEditorial,plan,draft,verifiedCollaborators)
 let facebookTitle:string|undefined
 if(plan.network==='facebook'){
  if(!saved&&(typeof draft.title!=='string'||!draft.title.trim()||Array.from(draft.title).length>100))throw Error('Existing Facebook title needs editorial review')
  facebookTitle=saved?.facebookTitle??draft.title as string
 }
 return {planId:plan.id,promoId:draft.id,videoSha256:match[1],network:plan.network,caption:plan.caption,scheduledAt,hashtags:saved?.hashtags??[],collaborators:saved?.collaborators??[],evidenceRef:saved?.evidenceRef??'current-plan-editorial:'+plan.id,...(facebookTitle===undefined?{}:{facebookTitle})}
}

