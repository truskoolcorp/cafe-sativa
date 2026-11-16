import type {SupabaseClient} from '@supabase/supabase-js'
import {normalizePromoCanon} from './character-promo-sources'
import {approvedAsset,type CanonicalAsset} from './policy'
import type {CafeCollaborator} from './character-promo-cafe-metricool'
import type {ReplenishmentSource} from './character-production-replenishment'
/** Exact trusted configuration, not request parameters or model-proposed IDs.
 * Evergreen editorial intent is not an event fact or per-post approval. Optional
 * event content requires an exact currently public record, not private proposals.
 * Collaborators require an existing reviewed persona registry; none are inferred
 * from brand nicknames. */
export type ReplenishmentSourceScope={characterId:string;roomKey:string;assignmentRole:string;topic: 'art-observation'|'host-conversation'|'public-event';publicEventId?:string;venueAssetId:string;venueSha256:string;verifiedCollaborators?:readonly CafeCollaborator[]}
export function createReplenishmentSourceLoader(scope:ReplenishmentSourceScope,d:{
 db:Pick<SupabaseClient,'from'>;publicDb?:Pick<SupabaseClient,'from'>;
 readGlyph:(signal:AbortSignal)=>Promise<unknown>;now:()=>number;signal:AbortSignal
}){
 const s=structuredClone(scope),uuid=/^[a-f0-9-]{36}$/,hash=/^[a-f0-9]{64}$/
 if(!/^[a-z0-9-]{1,100}$/.test(s.characterId)||['keith','keith-ingram'].includes(s.characterId)||! /^[a-z0-9_-]{1,100}$/.test(s.roomKey)||! /^[a-z0-9_]{1,60}$/.test(s.assignmentRole)||!['art-observation','host-conversation','public-event'].includes(s.topic)||(s.topic==='art-observation'&&s.roomKey!=='gallery')||(s.topic==='public-event'&&(!s.publicEventId||!uuid.test(s.publicEventId)||!d.publicDb))||(s.topic!=='public-event'&&s.publicEventId!==undefined)||!uuid.test(s.venueAssetId)||!hash.test(s.venueSha256))throw Error('Exact public-topic and venue scope required')
 const collaborators=s.verifiedCollaborators??[]
 if(collaborators.length>10||collaborators.some(v=>v.network!=='instagram'||v.characterId!==s.characterId||! /^[a-zA-Z0-9_.]{1,30}$/.test(v.handle)||typeof v.evidenceRef!=='string'||!v.evidenceRef.trim())||new Set(collaborators.map(v=>v.handle)).size!==collaborators.length)throw Error('Reviewed persona-specific collaborators required')
 async function records(){
  d.signal.throwIfAborted()
  const [host,venue,event,recent]=await Promise.all([
   d.db.from('cs_room_host_assignments').select('room_key,character_id,role,assignment_status').eq('room_key',s.roomKey).eq('character_id',s.characterId).eq('role',s.assignmentRole).eq('assignment_status','active').limit(3).abortSignal(d.signal),
   d.db.from('cs_canonical_assets').select('id,kind,subject,url,sha256,version,approved_by,approved_at,active').eq('kind','venue').eq('subject',s.roomKey).eq('active',true).limit(3).abortSignal(d.signal),
   // publicDb MUST be a fresh anonymous client, not owner/admin or visitor session.
   // Never read personalized access, tickets or membership into public content.
   s.topic==='public-event'?d.publicDb!.from('my_events_v').select('id,title,description,category,starts_at,status').eq('id',s.publicEventId!).limit(2).abortSignal(d.signal):Promise.resolve({data:[],error:null}),
   d.db.from('cs_character_promo_drafts').select('id,character_id,spoken_script,created_at').eq('character_id',s.characterId).order('created_at',{ascending:false}).limit(10).abortSignal(d.signal),
  ])
  d.signal.throwIfAborted()
  if([host,venue,event,recent].some(r=>r.error||!Array.isArray(r.data)))throw Error('Existing source read unavailable; no permission fallback')
  const hosts=host.data!,venues=venue.data!,events=event.data!,scripts=recent.data!
  if(hosts.length!==1||hosts[0].character_id!==s.characterId||hosts[0].room_key!==s.roomKey||hosts[0].assignment_status!=='active'||hosts[0].role!==s.assignmentRole)throw Error('Current room assignment ambiguous')
  if(venues.length!==1||venues[0].id!==s.venueAssetId||venues[0].sha256!==s.venueSha256||!approvedAsset(venues[0] as CanonicalAsset))throw Error('Approved current room reference changed or unresolved')
  const e=events[0]
  if(s.topic==='public-event'&&(events.length!==1||e.id!==s.publicEventId||e.category!==s.roomKey||e.status!=='scheduled'||typeof e.title!=='string'||!e.title.trim()||e.title.length>240||typeof e.description!=='string'||e.description.length>1200||!Number.isFinite(Date.parse(e.starts_at))||Date.parse(e.starts_at)<=d.now()))throw Error('Fresh exact public topic unavailable')
  if(scripts.length>10||scripts.some(r=>r.character_id!==s.characterId||!uuid.test(r.id)||typeof r.spoken_script!=='string'||!r.spoken_script.trim()||r.spoken_script.length>5000))throw Error('Recent script history unavailable')
  return {hosts,venues,events,scripts}
 }
 return async():Promise<ReplenishmentSource>=>{
  const started=d.now(),first=await records(),body=await d.readGlyph(d.signal)
  d.signal.throwIfAborted()
  const canon=normalizePromoCanon(body,s.characterId,new Date(started).toISOString()),last=await records(),now=d.now()
  if(!Number.isSafeInteger(started)||now<started||now-started>60000||JSON.stringify(first)!==JSON.stringify(last))throw Error('Source snapshot changed or expired')
  const e=last.events[0]
  return {characterId:s.characterId,canonicalRevision:canon.revision_sha256,voiceId:canon.voice_id,portraitSha256:canon.portrait_sha256,roomKey:s.roomKey,
   publicCanon:canon.canonical_context,
   publicProgramming:s.topic==='public-event'?JSON.stringify({title:e.title,description:e.description,status:e.status,startsAtLocal:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'full',timeStyle:'short'}).format(new Date(e.starts_at)),room:s.roomKey,hostParticipation:'Not verified; do not claim attendance or performance',admission:'Not supplied; do not claim price or access',venueReference:{id:s.venueAssetId,sha256:s.venueSha256,version:last.venues[0].version}}):JSON.stringify({eventFacts:'No event claims in this evergreen editorial intent',hostParticipation:'No attendance or physical presence claim',venueReference:{id:s.venueAssetId,sha256:s.venueSha256,version:last.venues[0].version}}),
   topic:s.topic==='public-event'?e.title:s.topic==='art-observation'?'Invite viewers to notice color, shape or perspective in art and share their own interpretation; do not invent a specific artwork or exhibition.':'Invite an original conversation in this host’s canonical voice and role; avoid claims about guests, attendance, products, menus or booked events.',verifiedHandles:collaborators.map(v=>v.handle),recentScripts:last.scripts.map(r=>r.spoken_script),observedAt:started}
 }
}
