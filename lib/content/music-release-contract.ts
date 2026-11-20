import {createHash} from 'node:crypto'
export const MUSIC_ORIGIN='https://www.cafe-sativa.com'
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type MediaRef={bucket:string;path:string;sha256:string}
export type MusicRelease={slug:string;title:string;description:string;songId:string;sequenceId:string;teaser:MediaRef;master:MediaRef;caption:string;scheduledAt:string;releaseAt:string}
export function mediaRef(v:any):MediaRef{
 if(!v||!/^[-a-z0-9_]{1,100}$/.test(v.bucket)||typeof v.path!=='string'||v.path.length>500||!/^[-a-zA-Z0-9_./]+\.mp4$/.test(v.path)||v.path.startsWith('/')||v.path.split('/').some((s:string)=>!s||s==='.'||s==='..')||!/^[a-f0-9]{64}$/.test(v.sha256))throw Error('Invalid private MP4 reference')
 return {bucket:v.bucket,path:v.path,sha256:v.sha256}
}
export function normalizeRelease(v:any,now=Date.now()):MusicRelease{
 if(!v||typeof v.slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug)||v.slug.length>100||typeof v.title!=='string'||!v.title.trim()||v.title.length>240||typeof v.description!=='string'||v.description.length>2500||!UUID.test(v.songId)||!/^cmp_[a-zA-Z0-9-]+$/.test(v.sequenceId)||typeof v.caption!=='string'||!v.caption.trim())throw Error('Invalid release details')
 const teaser=mediaRef(v.teaser),master=mediaRef(v.master)
 if(teaser.sha256===master.sha256 || (teaser.bucket===master.bucket && teaser.path===master.path))throw Error('A separate public teaser is required; the VIP master stays private')
 const scheduled=Date.parse(v.scheduledAt),release=Date.parse(v.releaseAt)
 if(!Number.isFinite(scheduled)||!Number.isFinite(release)||scheduled<now+30*60000||release<scheduled)throw Error('Marketing needs at least 30 minutes lead time and must not follow release')
 const caption=`${v.caption.trim()}\n\n${MUSIC_ORIGIN}/music/${v.slug}?utm_source=metricool&utm_medium=social&utm_campaign=${v.slug}`
 if(Array.from(caption).length>500)throw Error('Caption including release link must fit 500 characters')
 return {slug:v.slug,title:v.title.trim(),description:v.description,songId:v.songId,sequenceId:v.sequenceId,teaser,master,caption,scheduledAt:new Date(scheduled).toISOString(),releaseAt:new Date(release).toISOString()}
}
function canonical(v:any):string {return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)}
export function releaseDigest(v:MusicRelease){return createHash('sha256').update(canonical(v)).digest('hex')}
export function approvedRelease(row:any){return Boolean(row?.status==='approved'&&row.approved_by&&row.approved_at&&row.digest===releaseDigest(row.manifest))}
export function publicRelease(row:any,now=Date.now()){return approvedRelease(row)&&Date.parse(row.manifest.scheduledAt)<=now}
export function replayRow(row:any){const m=row.manifest as MusicRelease;return {id:row.id,title:m.title,description:m.description,storage_bucket:m.master.bucket,storage_path:m.master.path,status:'published',approved_at:row.approved_at,release_at:m.releaseAt}}
