import {createHash} from 'node:crypto'
/** Trusted stored app attempt, never caller data or external-intro registry. */
export type PublicationAttempt={planId:string;token:string;digest:string;providerId:string;providerUuid:string;network:'facebook'|'instagram';accountId:string;scheduledAt:string}
export type PublicationReadSession={call(name:'getBrandSettings'|'getScheduledPosts',args:object):Promise<unknown>}
const exact=(o:unknown,keys:string[])=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.sort().join(',')
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
const digest=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
function brand(raw:any){const rows=raw?.data;if(!Array.isArray(rows))throw Error('Brand unavailable');const matches=rows.filter((r:any)=>r.id===7605217&&r.userId===4174093);if(matches.length!==1)throw Error('Brand ambiguous');const b=matches[0];if(b.timezone!=='America/Chicago'||b.networksData?.facebookData!=='105363501666032'||b.networksData?.instagramData!=='cafesativainc')throw Error('Destination changed');return JSON.stringify([b.id,b.userId,b.timezone,b.networksData.facebookData,b.networksData.instagramData])}
function local(stamp:number){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(stamp),v=(k:string)=>p.find(p=>p.type===k)!.value;return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}:${v('second')}`}
function destination(network:string,id:unknown,url:unknown){if(typeof id!=='string'||typeof url!=='string'||url.length>500)throw Error('Published destination unavailable');const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)throw Error('Unexpected destination');if(network==='facebook'){if(!['facebook.com','www.facebook.com'].includes(u.hostname)||!/^\d{1,40}$/.test(id)||u.pathname.replace(/\/$/,'')!==`/reel/${id}`)throw Error('Facebook identity mismatch')}else{if(!['instagram.com','www.instagram.com'].includes(u.hostname)||!/^\/reel\/[A-Za-z0-9_-]{1,100}\/?$/.test(u.pathname)||id!==url)throw Error('Instagram identity mismatch')}return u.href}
/** Uses actual observed Metricool getScheduledPosts fields. Missing rows are
 * unknown, never proof of publication. No create/retry/edit tool is exposed.
 * Caller must drain the underlying authenticated session transports on exit. */
export async function reconcileCafePublication(attempt:PublicationAttempt,session:PublicationReadSession,signal:AbortSignal,enabled:()=>boolean,now=Date.now){
 const a=structuredClone(attempt),stamp=Date.parse(a.scheduledAt),started=now(),check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Publication reconciliation disabled')}
 if(!exact(a,['planId','token','digest','providerId','providerUuid','network','accountId','scheduledAt'])||!uuid(a.planId)||!uuid(a.token)||!digest(a.digest)||!/^\d{1,20}$/.test(a.providerId)||! /^-?\d{1,30}$/.test(a.providerUuid)||!['facebook','instagram'].includes(a.network)||a.accountId!==(a.network==='facebook'?'105363501666032':'cafesativainc')||!Number.isFinite(stamp)||!/(Z|[+-]\d\d:\d\d)$/.test(a.scheduledAt)||stamp>started)throw Error('Exact scheduled app attempt required')
 check();const before=brand(await session.call('getBrandSettings',{}));check()
 const raw:any=await session.call('getScheduledPosts',{brandId:'7605217',fromDate:new Date(stamp-86400000).toISOString(),toDate:new Date(stamp+86400000).toISOString(),timezone:'America/Chicago',extendedRange:false});check()
 if(!Array.isArray(raw?.data)||raw.data.length>2000)throw Error('Provider result unavailable')
 const rows=raw.data.filter((r:any)=>String(r.id)===a.providerId&&r.uuid===a.providerUuid)
 if(rows.length!==1)return {status:'unverified' as const,reason:'exact_post_not_found'}
 const post=rows[0]
 if(post.creatorUserId!==4174093||post.draft!==false||post.autoPublish!==true||post.publicationDate?.timezone!=='America/Chicago'||post.publicationDate?.dateTime!==local(stamp)||!Array.isArray(post.providers))throw Error('Scheduled identity changed')
 const providers=post.providers.filter((r:any)=>r.network===a.network)
 if(providers.length!==1)return {status:'unverified' as const,reason:'destination_not_unique'}
 const p=providers[0]
 if(p.status!=='PUBLISHED')return {status:'unverified' as const,reason:typeof p.status==='string'?p.status.slice(0,100):'status_unavailable'}
 const publicUrl=destination(a.network,p.id,p.publicUrl)
 const after=brand(await session.call('getBrandSettings',{}));check();if(before!==after)throw Error('Brand changed during reconciliation')
 const observedAt=new Date(now()).toISOString();if(Date.parse(observedAt)<started)throw Error('Clock changed')
 // Store raw field projection, not unbounded captions or credentials. The same
 // exact attempt is checked again by the owner-scoped receipt writer.
 const evidence=JSON.stringify({postId:String(post.id),postUuid:post.uuid,network:p.network,destinationId:p.id,status:p.status,publicUrl,publicationDate:post.publicationDate,creatorUserId:post.creatorUserId,brand:before})
 return {status:'published' as const,receipt:{version:1 as const,...a,brandId:'7605217',destinationId:p.id as string,publicUrl,observedAt,evidenceSha256:hash(evidence)},evidence}
}
