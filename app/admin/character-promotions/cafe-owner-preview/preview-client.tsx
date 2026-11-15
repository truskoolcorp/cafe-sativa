'use client'
import {useRef,useState} from 'react'
type Preview={status:string;planId:string;digest:string;schedule:unknown;submissionWindowEnds:string}
const attemptKey=(p:Preview)=>'cafe-owner-preview-attempt:'+p.planId+':'+p.digest
export default function OwnerPreview({planIds}:{planIds:string[]}){
 const [preview,setPreview]=useState<Preview|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false)
 const confirmLatch=useRef(false)
 async function review(planId:string){
  if(busy||confirmLatch.current)return
  setBusy(true);setPreview(null)
  try{const r=await fetch('/api/admin/character-promotions/cafe-owner-preview?planId='+encodeURIComponent(planId),{cache:'no-store'}),body=await r.json();if(!r.ok||body.status!=='preview')throw Error(body.error||body.reason||'Not ready');setPreview(body)
   if(sessionStorage.getItem(attemptKey(body))!==null){confirmLatch.current=true;setAttempted(true);setStatus('An approval submission was already attempted for this exact preview. Reconcile read-only; do not resubmit.')}else setStatus('Review the exact schedule below before confirming.')
  }catch(e){setStatus(e instanceof Error?e.message:'Preview unavailable')}finally{setBusy(false)}
 }
 async function confirm(){
  if(!preview||busy||confirmLatch.current)return
  // Synchronous latch precedes storage and network, preventing same-render double clicks.
  confirmLatch.current=true;setAttempted(true);setBusy(true)
  try{
   const key=attemptKey(preview)
   if(sessionStorage.getItem(key)!==null){setStatus('Already attempted. Reconcile read-only; do not resubmit.');return}
   // Fail closed if browser storage is unavailable; never POST without the refresh-persistent marker.
   sessionStorage.setItem(key,'attempted')
   const r=await fetch('/api/admin/character-promotions/cafe-owner-preview',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({planId:preview.planId,digest:preview.digest,confirm:true})}),body=await r.json()
   setStatus(r.ok&&body.status==='recorded'&&typeof body.approvalExpiresAt==='string'?'Finite approval recorded. Approval expires '+body.approvalExpiresAt+'. Not scheduled or published.':(body.error||'Unconfirmed. Do not resubmit; reconcile read-only.'))
  }catch{setStatus('Result unconfirmed or submission blocked. Do not resubmit; reconcile read-only.')}finally{setBusy(false)}
 }
 return <section>{planIds.map(id=><button key={id} disabled={busy||attempted} onClick={()=>review(id)}>Review plan {id}</button>)}<p role="status">{status}</p>{preview&&<><pre>{JSON.stringify(preview.schedule,null,2)}</pre><p>Submission window ends {preview.submissionWindowEnds}. The actual approval expires at the earliest of the submission-window end, 15 minutes after confirmation, or one minute before the scheduled post. Digest: {preview.digest}</p><button disabled={busy||attempted} onClick={confirm}>Confirm this exact finite approval</button></>}</section>
}
