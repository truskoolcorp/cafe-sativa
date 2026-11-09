import type { readCharacterPromoMaterial } from './character-promo-material'
import type { PromoReviewSources } from './character-promo-sources'
import { createHash } from 'node:crypto'
/** Observed-read consistency, not an atomic source lock. Final writes still use SQL CAS. */
export function promoVisibleMaterialMatches(c:Awaited<ReturnType<typeof readCharacterPromoMaterial>>,s:PromoReviewSources) {
 const d=s.draft,p=s.plan
 const qa=c.checks.flatMap(q=>q.observations).sort((a,b)=>a.check_name.localeCompare(b.check_name))
 const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v)
 return c.draft.id===d.id&&c.draft.characterId===d.character_id&&c.draft.revision===d.updated_at&&c.draft.script===d.spoken_script&&c.draft.visualBrief===d.visual_brief&&c.draft.targetDurationSeconds===d.duration_seconds&&c.draft.status===d.status&&c.plan.id===p.id&&c.plan.network===p.network&&c.plan.accountId===p.account_id&&c.plan.caption===p.caption&&c.plan.scheduledAt===p.scheduled_at&&c.plan.status===p.status&&c.video.bytes===s.videoBytes.length&&c.video.sha256===createHash('sha256').update(s.videoBytes).digest('hex')&&canonical(qa)===canonical([...s.qa].sort((a,b)=>a.check_name.localeCompare(b.check_name)))
}
