import { personaReviewHandlers } from '@/lib/content/character-promo-runtime'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function POST(req:Request){return personaReviewHandlers().POST(req)}
