import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {cafeBoundedReadFetch} from './character-promo-cafe-read-fetch'
import {createProductionFetch} from './character-production-bounded-fetch'
import {liveGlyphCharacters} from './glyph-live'
import {readPromoMetricoolBrands} from './character-promo-metricool-readonly'
import {metricoolSession} from './metricool-mcp'
import {unseal} from './metricool-oauth'
import {diagnoseCafePlan,loadCafeApprovalCandidate} from './character-promo-cafe-sources'
import type {CafeEditorialMetadata} from './character-promo-cafe-sources'
import type {CafeCollaborator} from './character-promo-cafe-metricool'
/** Lazy caller-only composition, no route/flag/credentials copied. Existing
 * verified owner session may list brands; returned Café mapping is checked anew.
 * Existing legacy connection constraints are NOT weakened to make this work. */
export function createCafeSourceReader(config:{signal:AbortSignal;metadata:ReadonlyMap<string,CafeEditorialMetadata>;verifiedCollaborators:readonly CafeCollaborator[]}){
 const signal=AbortSignal.any([config.signal,AbortSignal.timeout(55000)])
 const network=createProductionFetch(signal),db=createAdminClient(cafeBoundedReadFetch(network.fetch)),storageDb=createAdminClient(network.fetch)
 const deps={...config,signal,db:{from:db.from.bind(db),storage:storageDb.storage},now:Date.now,readGlyph:liveGlyphCharacters,readMetricoolBrands:()=>readPromoMetricoolBrands({db,now:Date.now,decrypt:v=>unseal(v,'credentials'),openSession:(token:string)=>metricoolSession(token,signal)})}
 return {diagnose:(id:string)=>diagnoseCafePlan(id,deps),load:(id:string)=>loadCafeApprovalCandidate(id,deps),whenSettled:network.whenSettled}
}
