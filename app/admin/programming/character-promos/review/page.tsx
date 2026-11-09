import { personaDispatchRuntimeEnabled } from '@/lib/content/character-promo-dispatch-runtime'
import { personaReviewRuntimeEnabled } from '@/lib/content/character-promo-runtime'
import { isContentAdmin } from '@/lib/content/auth'
import CharacterPromoReviewWorkspace from '@/components/admin/CharacterPromoReviewWorkspace'
export const dynamic='force-dynamic'
export default async function PromoReviewPage({searchParams}:{searchParams:{planId?:string}}) {
 if(!personaReviewRuntimeEnabled())return <main className="mx-auto max-w-3xl px-5 pb-16 pt-28"><h1 className="text-2xl font-bold">Persona review is not activated</h1><p className="mt-3">Protected review and authoring are disabled pending approved database/security rollout. No approvals or posts can be triggered here.</p></main>
 if(!await isContentAdmin())return <main className="px-5 pt-28">Administrator access required.</main>
 return <CharacterPromoReviewWorkspace initialPlanId={searchParams.planId||''} dispatchEnabled={personaDispatchRuntimeEnabled()}/>
}
