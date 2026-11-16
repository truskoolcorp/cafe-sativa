import { personaDispatchHandler } from '@/lib/content/character-promo-dispatch-runtime'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function POST(request:Request){return personaDispatchHandler()(request)}
