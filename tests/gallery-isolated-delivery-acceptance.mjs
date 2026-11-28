import {createHash} from 'node:crypto'

// Imported by the existing private one-shot Mac runner; never launches a payment,
// provisions resources, or runs on import. Inputs must remain in that runner's memory.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const max=50*1024*1024
const require=(ok,phase)=>{if(!ok)throw Error('Gallery isolated acceptance: '+phase)}
const loopback=value=>{try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&u.origin===value}catch{return false}}
const hash=b=>createHash('sha256').update(b).digest('hex')
async function bytes(r){
 const reader=r.body?.getReader();require(reader,'missing response body');let n=0;const chunks=[]
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;require(n<=max,'response too large');chunks.push(Buffer.from(value))}return Buffer.concat(chunks,n)}finally{await reader.cancel().catch(()=>{})}
}
async function request(origin,path,options={}){
 try{return await fetch(origin+path,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(65000)})}
 catch{throw Error('Gallery isolated acceptance: local request failed')}
}
async function json(r){try{return JSON.parse((await bytes(r)).toString('utf8'))}catch{throw Error('Gallery isolated acceptance: invalid JSON response')}}
const storageHeaders=(key,token)=>({apikey:key,Authorization:'Bearer '+token})
const objectPath=(bucket,path)=>'/storage/v1/object/authenticated/'+bucket+'/'+path
const signPath=(bucket,path)=>'/storage/v1/object/sign/'+bucket+'/'+path
const safeObject=(path,id)=>typeof path==='string'&&path.startsWith(id+'/')&&/^[A-Za-z0-9_./-]+$/.test(path)&&!path.includes('..')&&!path.includes('//')&&!path.endsWith('/')
async function denied(r,phase){
 require([400,401,403,404].includes(r.status),phase+' status')
 const j=await json(r);require(j&&typeof j==='object'&&!Array.isArray(j)&&!j.signedURL&&!j.signedUrl&&!j.url&&(j.error||j.message||j.statusCode),phase+' error')
}
/** Verify a previously paid/refunded fixture, not a newly created session.
 * Never pass a live URL, actual customer, service role in buyer fields or provider key.
 * Before call: same-run lock, dedicated test-only ingress and disposable database
 * identity must be established by the existing runner. No standalone execution. */
export async function verifyGalleryDelivery({app,api,anonKey,serviceKey,buyers,orderId,productId,sourcePath,destinationPath,sha256,phase}){
 require(loopback(app)&&loopback(api)&&app!==api,'loopback origins')
 require(uuid.test(orderId)&&uuid.test(productId)&&safeObject(sourcePath,productId)&&safeObject(destinationPath,orderId)&&/^[a-f0-9]{64}$/.test(sha256),'fixture identity')
 require(phase==='paid'||phase==='refunded','phase')
 require(Array.isArray(buyers)&&buyers.length===2&&buyers.every(b=>uuid.test(b.id)&&typeof b.token==='string'&&b.token.length>0&&typeof b.cookie==='string'&&b.cookie.length>0)&&buyers[0].id!==buyers[1].id&&buyers[0].token!==buyers[1].token&&buyers[0].cookie!==buyers[1].cookie,'two independent buyers')
 require([anonKey,serviceKey,...buyers.map(b=>b.token)].every(k=>typeof k==='string'&&k.length>0&&!/[\r\n]/.test(k))&&new Set([anonKey,serviceKey,...buyers.map(b=>b.token)]).size===4,'credential separation')
 // Positive controls prove the actual local sessions and exact objects exist before interpreting denials.
 for(const b of buyers){const r=await request(api,'/auth/v1/user',{headers:storageHeaders(anonKey,b.token)});require(r.ok,'buyer authentication');require((await json(r)).id===b.id,'buyer identity')}
 for(const [bucket,path] of [['gallery-approved',sourcePath],['gallery-private',destinationPath]]){
  const service=storageHeaders(serviceKey,serviceKey)
  const bucketResponse=await request(api,'/storage/v1/bucket/'+bucket,{headers:service});require(bucketResponse.ok,'bucket read');const meta=await json(bucketResponse);require(meta.id===bucket&&meta.public===false,'private bucket')
  const control=await request(api,objectPath(bucket,path),{headers:service});require(control.ok&&hash(await bytes(control))===sha256,'service-only exact bytes')
  for(const token of [anonKey,...buyers.map(b=>b.token)]){
   const headers=storageHeaders(anonKey,token)
   await denied(await request(api,objectPath(bucket,path),{headers}),'direct storage read')
   await denied(await request(api,signPath(bucket,path),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{"expiresIn":60}'}),'direct storage signing')
  }
  await denied(await request(api,'/storage/v1/object/public/'+bucket+'/'+path),'public storage read')
 }
 const path='/api/gallery/download?order='+orderId
 const buyer=await request(app,path,{headers:{Cookie:buyers[0].cookie}})
 if(phase==='paid'){
  require(buyer.status===200&&(buyer.headers.get('content-type')??'').startsWith('application/octet-stream')&&(buyer.headers.get('content-disposition')??'').startsWith('attachment;')&&(buyer.headers.get('cache-control')??'').includes('no-store'),'authenticated attachment')
  require(hash(await bytes(buyer))===sha256,'buyer attachment SHA')
 }else{require(buyer.status===404,'refunded buyer denial');await denied(buyer,'refunded buyer')}
 const other=await request(app,path,{headers:{Cookie:buyers[1].cookie}});require(other.status===404,'nonbuyer denial');await denied(other,'nonbuyer')
 const anonymous=await request(app,path);require(anonymous.status===401,'anonymous denial');await denied(anonymous,'anonymous')
 return {phase,authenticatedAttachment:phase==='paid',directStorageDenied:true,otherBuyerDenied:true,anonymousDenied:true,shaVerified:true}
}
