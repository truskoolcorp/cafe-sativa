import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {provisionCharacterStorage} from '@/lib/content/character-production-storage-provisioning'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
async function authorized(){let t:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([isContentAdmin(),new Promise<false>(resolve=>{t=setTimeout(()=>resolve(false),5000)})])}finally{clearTimeout(t)}}
async function run(req:Request,create:boolean){
 if(create&&req.headers.get('origin')!=='https://www.cafe-sativa.com')return Response.json({error:'Invalid origin'},{status:403,headers})
 if(!await authorized())return Response.json({error:'Unauthorized'},{status:401,headers})
 if(create&&(req.headers.get('content-length')??'0')!=='0')return Response.json({error:'No request body allowed'},{status:400,headers})
 try{return Response.json(await provisionCharacterStorage(createAdminClient().storage,create),{headers})}
 catch{return Response.json({error:'Storage operation unconfirmed. Inspect current status before another attempt; no bucket settings were overwritten.'},{status:503,headers})}
}
export async function GET(req:Request){return run(req,false)}
export async function POST(req:Request){return run(req,true)}
