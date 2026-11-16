'use client'
import {useEffect,useRef,useState} from 'react'
import Workspace from '../../../components/admin/CharacterPromoReviewWorkspace'
import Panel from '../../../components/admin/CharacterPromoReviewPanel'
import Dispatch from '../../../components/admin/CharacterPromoDispatchConfirmation'
const id='11111111-1111-4111-8111-111111111111',sha='a'.repeat(64),digest='b'.repeat(64)
const assetId='33333333-3333-4333-8333-333333333333'
const long='FAKE TEST ONLY. Long spoken script and caption for layout testing. '.repeat(7)
const snapshot:any={planId:id,promoId:'FAKE-PROMO',videoSha256:sha,videoBytes:1024,network:'threads',accountId:'FAKE-ACCOUNT-NOT-REAL',brandId:'FAKE-BRAND',userId:'FAKE-USER',caption:long,scheduledAt:'2026-12-01T12:00:00.000Z',timezone:'America/Chicago'}
const content={...snapshot,durationSeconds:30,script:long,visualBrief:'FAKE visual brief',characterId:'FAKE-CHARACTER',canon:{assetId:'FAKE-ASSET',portraitSha256:sha,voiceId:'FAKE-VOICE',revisionSha256:sha}}
const checks=[{name:'brand_safety',passed:false,observations:[]}]
const model:any={content,blockers:[],checks,confirmed:{voice:true,video:false,publication:false},nextAction:'video',canonicalContext:'FAKE canonical context',dispatchBlockers:[],contentDigest:digest,reviewedStateDigest:digest,dispatchPrerequisitesMet:true}
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})
export default function Page(){
 const [ready,setReady]=useState(false),[mode,setMode]=useState('dispatch'),[calls,setCalls]=useState(0),[pending,setPending]=useState(false),[actions,setActions]=useState<string[]>([]),[unexpected,setUnexpected]=useState<string[]>([])
 const current=useRef(mode);current.current=mode
 const state=useRef({withdrawn:false,attempted:false,qa:false,video:false,assetChanged:false})
 const release=useRef<null|(()=>void)>(null)
 useEffect(()=>{
  window.fetch=async(input,init)=>{
   const url=String(input),active=current.current,method=init?.method||'GET'
   const base='/api/admin/programming/character-promos'
   const allowed=method==='GET'?(url===base||url===base+'/review?promoId='+assetId||[id,'22222222-2222-4222-8222-222222222222'].some(plan=>url===base+'/review?planId='+plan)):(method==='POST'&&(url===base+'/dispatch'||url===base+'/review-action'))
   if(!allowed){setUnexpected(a=>[...a,method+' '+url]);throw Error('Unexpected synthetic request rejected')}
   if(init?.method==='POST'){
    setCalls(x=>x+1);const body=JSON.parse(String(init.body));setActions(a=>[...a,body.action||'dispatch'])
    if(url.endsWith('/dispatch')&&(active==='dispatch-pending'||active==='dispatch-success'||active==='workspace-live')){
     state.current.attempted=true
     if(active==='dispatch-pending')await new Promise<void>(resolve=>{release.current=resolve;setPending(true)})
     return response({status:'scheduled',publicationConfirmed:false,receipt:{...snapshot,state:'scheduled',providerId:'FAKE-PROVIDER',providerUuid:'FAKE-RECEIPT',snapshotDigest:digest}})
    }
    if(active.startsWith('workspace-asset')){
     if(body.action!=='record_qa'||body.promoId!==assetId||body.videoSha256!==sha||body.draftRevision!=='2026-11-09T12:00:00.000Z'||body.explicitConfirmation!==true||'planId' in body)throw Error('Unexpected asset action')
     if(active==='workspace-asset-stale'){state.current.assetChanged=true;return response({error:'SYNTHETIC stale hash/revision. Reload before retrying.'},409)}
     if(active==='workspace-asset-unknown')return response({error:'SYNTHETIC unknown save outcome. Reload before retrying.'},503)
     state.current.qa=true;return response({saved:true,approvalGranted:false})
    }
    if(active==='workspace-live'){
     if(body.action==='record_qa'){state.current.qa=true;return response({status:'recorded'})}
     if(body.action==='video'){state.current.video=true;return response({status:'recorded'})}
     if(body.action==='review_plan_control')return response({review:{digest,snapshot:{reviewId:'FAKE-CONTROL',planId:id,action:body.controlAction,effect:`SYNTHETIC: ${body.controlAction} only this unattempted destination; prior consent invalidated; no provider cancellation.`,expectedCohort:[]}}})
     if(body.action==='save_plan_control'){state.current.withdrawn=body.review.snapshot.action==='withdraw';return response({result:{providerCancelled:false,dispatched:false,consentInvalidated:true,reviewId:'FAKE-CONTROL'}})}
    }
    return response({error:'SYNTHETIC uncertain response: no action executed'},503)
   }
   if(url===base+'/review?promoId='+assetId){
    const hash=state.current.assetChanged?'c'.repeat(64):sha
    return response({candidate:{draft:{id:assetId,characterId:'FAKE-UNPLANNED',title:'Synthetic unplanned clip',script:long,visualBrief:'Synthetic asset only',revision:state.current.assetChanged?'2026-11-09T12:01:00.000Z':'2026-11-09T12:00:00.000Z',targetDurationSeconds:30},video:{sha256:hash,bytes:1024,previewPath:`/api/admin/programming/character-promos/review-media?promoId=${assetId}&sha256=${hash}`},plan:null,checks:checks.map(q=>({...q,observations:state.current.qa?[{id:'FAKE-QA',evidence:'FAKE TEST ONLY: explicit observation',result:'needs_review'}]:[]})),blockers:['delivery_plan_not_selected']},canonicalMaterial:null,canonicalBlocker:'Synthetic canon unavailable',review:null,executionReview:null,reviewBlocker:{code:'asset_review_only',message:'Asset review only; no delivery approvals.'},controls:null})
   }
   if(url.includes('/review?')){
    const currentChecks=checks.map(q=>({...q,observations:state.current.qa?[{id:'FAKE-QA',evidence:'FAKE TEST ONLY: current video needs review.',result:'needs_review',reviewer_id:'FAKE-REVIEWER',created_at:'2026-11-09T12:00:00.000Z'}]:[]}))
    const live=active==='workspace-live',time=live?snapshot.scheduledAt:url.includes('22222222')?null:'2026-12-01T12:00:00.123Z'
    return response({candidate:{draft:{id:'FAKE-PROMO',characterId:'FAKE-CHARACTER',title:'Synthetic fixture only',script:long,visualBrief:'No real media loaded',revision:1,targetDurationSeconds:30},video:{sha256:sha,bytes:1024,previewPath:live?`/api/admin/programming/character-promos/review-media?promoId=FAKE-PROMO&sha256=${sha}`:null},plan:{network:'threads',accountId:snapshot.accountId,caption:long,scheduledAt:time},checks:live?currentChecks:[],blockers:[]},canonicalMaterial:null,canonicalBlocker:'Synthetic canon unavailable',review:live?{...model,checks:currentChecks,nextAction:state.current.video?null:'video',confirmed:{...model.confirmed,video:state.current.video}}:null,executionReview:live?{digest,snapshot}:null,reviewBlocker:null,controls:{withdrawn:state.current.withdrawn,targetAttemptState:state.current.attempted?'scheduled':null,hasSharedAttempt:state.current.attempted,cohort:[]}})
   }
   return response({drafts:[{id:assetId,character_id:'FAKE-UNPLANNED',title:'Synthetic unplanned clip'}],plans:[{id,network:'threads',account_id:'FAKE fractional time'},{id:'22222222-2222-4222-8222-222222222222',network:'threads',account_id:'FAKE absent time'}]})
  };setReady(true)
 },[])
 return <><header style={{padding:16,background:'#422006'}}><h1>ISOLATED SYNTHETIC QA · NO REAL MEDIA OR PROVIDER CALLS</h1><label>Fixture scenario<select aria-label="Fixture scenario" value={mode} onChange={e=>{if(e.target.value.startsWith('workspace'))state.current={withdrawn:false,attempted:false,qa:false,video:false,assetChanged:false};setMode(e.target.value)}} style={{color:'black'}}>{['dispatch','disabled','fractional','workspace','panel','dispatch-success','dispatch-pending','workspace-live','workspace-asset','workspace-asset-stale','workspace-asset-unknown'].map(m=><option key={m} value={m}>{m}</option>)}</select></label><p>Mock POST count: {calls}</p><p data-testid="unexpected-requests">{unexpected.join(",")}</p><p data-testid="mock-actions" style={{overflowWrap:'anywhere'}}>{actions.join(',')}</p>{pending&&<button onClick={()=>{setPending(false);release.current?.();release.current=null}}>Release synthetic pending response</button>}</header><div style={{width:'100%',margin:'auto'}}>{ready&&(mode==='panel'?<Panel model={model}/>:mode.startsWith('workspace')?<Workspace key={mode} initialPlanId={mode.startsWith('workspace-asset')?'':id} dispatchEnabled={mode==='workspace-live'}/>:<Dispatch key={mode} enabled={mode!=='disabled'} snapshot={{...snapshot,scheduledAt:mode==='fractional'?'2026-12-01T12:00:00.123Z':snapshot.scheduledAt}} reviewedDigest={digest}/>)}</div></>
}
