import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from '@/lib/content/character-production-bounded-fetch'
import {createPrivateOutputStorage} from '@/lib/content/character-production-broker-boundary'
import {createOriginalRecoveryHandler} from '@/lib/content/character-production-original-recovery'
export const dynamic='force-dynamic'
export const maxDuration=60
export const POST=createOriginalRecoveryHandler({authorize:isContentAdmin,open(signal){
 const network=createProductionFetch(signal),db=createAdminClient(network.fetch)
 return {storage:createPrivateOutputStorage(db.storage,15000),whenSettled:network.whenSettled,
 async read(){const r=await db.rpc('character_production_original_recovery_job').abortSignal(signal).retry(false);if(r.error)throw Error('Recovery read unavailable');return r.data},
 async commit(job){const r=await db.rpc('character_production_original_recovery_commit',{p_job:job}).abortSignal(signal).retry(false);return !r.error&&r.data===true}}
}})

export async function GET(){
 if(!await isContentAdmin())return new Response('Unauthorized',{status:401})
 return new Response(`<!doctype html><html><meta charset="utf-8"><title>Private original-output recovery</title><h1>Recover the original Zaria video</h1><p>Private storage only. This does not generate, approve, or publish a video. Select the original 4,023,955-byte MP4.</p><input id="file" type="file" accept="video/mp4"><button id="recover">Recover exact original</button><pre id="status"></pre><script>
 const button=document.getElementById('recover'),output=document.getElementById('status');
 button.onclick=async()=>{const file=document.getElementById('file').files[0];if(!file||file.size!==4023955){output.textContent='Select the exact original MP4.';return}button.disabled=true;output.textContent='Verifying and recovering private output…';try{const response=await fetch(location.pathname,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'video/mp4'},body:file});output.textContent=JSON.stringify(await response.json(),null,2)}catch{output.textContent='Outcome unconfirmed. Inspect the original private output before trying again.'}};
 </script></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})
}
