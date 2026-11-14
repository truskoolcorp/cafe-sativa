import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {canaryInputs,importCanaryInput} from '@/lib/content/character-production-canary-input'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
export async function POST(req:Request){
 if(req.headers.get('origin')!=='https://www.cafe-sativa.com')return Response.json({error:'Invalid origin'},{status:403,headers})
 let timer:ReturnType<typeof setTimeout>|undefined
 try{
  const admin=await Promise.race([isContentAdmin(),new Promise<false>(r=>{timer=setTimeout(()=>r(false),5000)})]);clearTimeout(timer)
  if(!admin)return Response.json({error:'Unauthorized'},{status:401,headers})
  const kind=req.headers.get('x-input-kind');if(kind!=='audio'&&kind!=='image')throw Error('Invalid input')
  const expected=canaryInputs[kind];if(!req.body||Number(req.headers.get('content-length'))!==expected.bytes)throw Error('Exact input size required')
  const reader=req.body.getReader(),parts:Uint8Array[]=[];let size=0
  const body=async()=>{try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>expected.bytes||parts.length>=4096)throw Error('Input exceeds bound');parts.push(part.value)}return Buffer.concat(parts)}finally{void reader.cancel().catch(()=>{})}}
  const bytes=await Promise.race([body(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('Input timeout'))},5000)})]);clearTimeout(timer)
  return Response.json(await importCanaryInput(kind,bytes,createAdminClient().storage),{headers})
 }catch{return Response.json({error:'Input not confirmed; inspect storage before another attempt. No generation or publishing occurred.'},{status:409,headers})}finally{clearTimeout(timer)}
}
