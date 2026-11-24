import {timingSafeEqual} from 'node:crypto'
import {authorizeStagedDigitalOrders} from '@/lib/gallery/fulfill-digital'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'no-store'}
export async function GET(req:Request){
 const secret=process.env.CRON_SECRET
 const actual=Buffer.from(req.headers.get('authorization')||'')
 const expected=Buffer.from('Bearer '+(secret||''))
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:'Unauthorized'},{status:401,headers})
 try{
  const result=await authorizeStagedDigitalOrders()
  if(result.deferred)console.warn('[gallery-worker] Deferred orders',result.deferred)
  return Response.json(result,{headers})
 }catch{
  console.error('[gallery-worker] Fulfillment unavailable')
  return Response.json({error:'Fulfillment unavailable'},{status:503,headers})
 }
}
