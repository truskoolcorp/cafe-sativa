import 'server-only'
import {isContentAdmin} from '@/lib/content/auth'
import {createElevenLabsInventory} from '@/lib/content/character-production-elevenlabs-inventory'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function GET(){
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
 if(!await isContentAdmin())return Response.json({error:'Unauthorized'},{status:401,headers})
 try{
  // Known canonical ID and requested connector model label; read-only probe
  // reports incompatibility instead of selecting an alternative voice/model.
  const api=createElevenLabsInventory(()=>process.env.ELEVENLABS_API_KEY)
  const [result,subscription]=await Promise.all([api.inspect('5zneNR4v1Uw5AjIZ9Un4','eleven_v4'),api.subscription()])
  return Response.json({...result,subscription},{headers})
 }catch{return Response.json({error:'Voice inventory unavailable; synthesis remains unverified'},{status:503,headers})}
}
