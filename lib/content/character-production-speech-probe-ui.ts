export function createOneShotProbeClick(attemptId:string,storage:Pick<Storage,'getItem'|'setItem'>,fetcher:typeof fetch=fetch){
 const key='cafe-speech-storage-probe-click:'+attemptId
 let attempted=false
 const used=()=>{try{return attempted||storage.getItem(key)!==null}catch{return true}}
 return {used,async run(){
  if(used())throw Error('Attempt already requested or browser storage unavailable. Reconcile the known marker; do not retry.')
  attempted=true
  // Persist before network. Refresh must not offer automatic resubmission.
  storage.setItem(key,'requested')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000)
  try{
   const response=await fetcher('/api/admin/character-promotions/speech-storage-probe',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal})
   const result=await response.json()
   return {httpStatus:response.status,result}
  }finally{clearTimeout(timer)}
 }}
}
