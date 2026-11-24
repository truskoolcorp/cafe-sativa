import {zariaBridge} from '@/lib/gallery/zaria-voice-v1-handler'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function POST(req:Request){return zariaBridge(req,'turn')}
