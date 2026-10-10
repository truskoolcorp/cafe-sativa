import { createHash } from 'node:crypto'
export const SOCIAL_NETWORKS=['facebook','threads'] as const
export function captionHash(caption:string) {return createHash('sha256').update(caption).digest('hex')}
export function validSocialApproval(row:any,item:any,now=new Date()) {
  return Boolean(row?.approved_by && row.approved_at && row.caption?.trim() && Array.from(row.caption).length<=500 && row.caption_hash===captionHash(row.caption) && item?.approved_by && item.approved_at && ['approved','scheduled','published'].includes(item.status) && item.copy_final===row.caption && item.source_job_id===row.source_job_id && new Date(item.scheduled_at).getTime()===new Date(row.scheduled_at).getTime() && new Date(row.scheduled_at).getTime()>now.getTime()+60000)
}
export function providerLocalDate(iso:string,timezone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso))
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}
export function verifySocialToolContract(tools:any[]) {
  for(const [name,properties] of Object.entries({getScheduledPosts:{brandId:'string',fromDate:'string',toDate:'string',timezone:'string'},createScheduledPost:{blogId:'string',date:'string',info:'string',mediaFiles:'array'}})) {
    const tool=tools.find(tool=>tool.name.replace(/_/g,'').toLowerCase()===name.toLowerCase())
    const schema=tool?.inputSchema
    if(!schema || Object.entries(properties).some(([key,type])=>schema.properties?.[key]?.type!==type) || (schema.required || []).some((key:string)=>!(key in properties) && !(name==='getScheduledPosts' && key==='extendedRange')))throw new Error('Metricool tool schema needs review')
  }
}
export function socialPostMatches(post:any,row:any,timezone:string) {
  const networks=(post.providers || []).map((p:any)=>p.network).sort().join(',')
  return post.text===row.caption && networks==='facebook,threads' && post.publicationDate?.timezone===timezone && post.publicationDate?.dateTime===providerLocalDate(row.scheduled_at,timezone)
}
export function socialCreateArguments(row:any,timezone:string,mediaUrl:string) {
  const local=providerLocalDate(row.scheduled_at,timezone)
  return {blogId:'5373515',date:local,mediaFiles:[mediaUrl],info:JSON.stringify({text:row.caption,providers:SOCIAL_NETWORKS.map(network=>({network})),publicationDate:{dateTime:local,timezone},autoPublish:true,draft:false,facebookData:{type:'POST'},threadsData:{type:'POST',replyControl:'EVERYONE',shareAsInstagramStory:false}})}
}
