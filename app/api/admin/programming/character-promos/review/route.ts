import { personaReviewHandlers } from '@/lib/content/character-promo-runtime'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function GET(req:Request){return personaReviewHandlers().GET(req)}
