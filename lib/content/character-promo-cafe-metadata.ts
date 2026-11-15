import {createHash} from 'node:crypto'
/** Inert Café-only contract. No caller, DB write, destination extension or provider call. */
const MAPPING_REVISION='cafe-metricool-metadata-20261115-v1' as const
const COLLABORATORS=['truskoolcorp','dotproject2017'] as const
const MENTIONS=['cafesativainc',...COLLABORATORS] as const
export type CafeMetadata={version:1;mappingRevision:typeof MAPPING_REVISION;brandId:'7605217';userId:'4174093';network:'facebook'|'instagram';accountId:'105363501666032'|'cafesativainc';caption:string;facebookTitle:string|null;hashtags:string[];collaborators:('truskoolcorp'|'dotproject2017')[];collaborationStatus:'not_requested'|'invitation_configured_not_accepted'}
const fail=()=>{throw Error('Unsupported or unreviewed Café metadata')}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>}
function keys(v:Record<string,unknown>,allowed:string[]){if(Object.keys(v).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(v,k)))fail()}
/** Caption is already owner-approved final text; never generates, appends or rewrites it. */
export function buildCafeMetadata(input:unknown):CafeMetadata {
 const x=object(input);keys(x,['network','approvedCaption','facebookTitle','hashtags','collaborators'])
 if(x.network!=='facebook'&&x.network!=='instagram')fail()
 if(typeof x.approvedCaption!=='string'||!x.approvedCaption.trim()||Array.from(x.approvedCaption).length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(x.approvedCaption))fail()
 const caption=x.approvedCaption as string
 if(x.facebookTitle!==null&&(x.network!=='facebook'||typeof x.facebookTitle!=='string'||!x.facebookTitle.trim()||Array.from(x.facebookTitle).length>100||/[\u0000-\u001f\u007f]/.test(x.facebookTitle)))fail()
 if(!Array.isArray(x.hashtags)||x.hashtags.length>5||x.hashtags.some(t=>typeof t!=='string'||!/^#[A-Za-z][A-Za-z0-9_]{0,49}$/.test(t)))fail()
 const hashtags=x.hashtags as string[],found=caption.match(/#[\p{L}\p{N}_]+/gu)||[]
 if(new Set(hashtags.map(t=>t.toLowerCase())).size!==hashtags.length||JSON.stringify(found)!==JSON.stringify(hashtags))fail()
 const mentions=caption.match(/@[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*/g)||[]
 if(x.network==='facebook'&&caption.includes('@'))fail()
 if(mentions.some(m=>!(MENTIONS as readonly string[]).includes(m.slice(1))))fail()
 if(!Array.isArray(x.collaborators)||x.collaborators.length>2||x.collaborators.some(h=>!(COLLABORATORS as readonly unknown[]).includes(h))||new Set(x.collaborators).size!==x.collaborators.length)fail()
 if(x.network==='facebook'&&(x.collaborators as unknown[]).length)fail()
 const collaborators=x.collaborators as CafeMetadata['collaborators']
 return {version:1,mappingRevision:MAPPING_REVISION,brandId:'7605217',userId:'4174093',network:x.network as CafeMetadata['network'],accountId:x.network==='facebook'?'105363501666032':'cafesativainc',caption,facebookTitle:x.facebookTitle as string|null,hashtags:[...hashtags],collaborators:[...collaborators],collaborationStatus:collaborators.length?'invitation_configured_not_accepted':'not_requested'}
}
/** Reconstruct all fixed fields; rejects forged mappings, unsupported title/eligibility fields. */
export function validateCafeMetadata(value:unknown):CafeMetadata {
 const x=object(value);keys(x,['version','mappingRevision','brandId','userId','network','accountId','caption','facebookTitle','hashtags','collaborators','collaborationStatus'])
 const expected=buildCafeMetadata({network:x.network,approvedCaption:x.caption,facebookTitle:x.facebookTitle as string|null,hashtags:x.hashtags,collaborators:x.collaborators})
 for(const k of Object.keys(expected) as (keyof CafeMetadata)[])if(JSON.stringify(x[k])!==JSON.stringify(expected[k]))fail()
 return expected
}
export function cafeMetadataDigest(value:unknown){return createHash('sha256').update(JSON.stringify(validateCafeMetadata(value))).digest('hex')}
/** Proven Reel fields only. Title shape verified in official app.metricool.com/api/swagger.json. */
export function serializeCafeMetadata(value:unknown){
 const s=validateCafeMetadata(value)
 return s.network==='facebook'?{text:s.caption,facebookData:{type:'REEL',...(s.facebookTitle===null?{}:{title:s.facebookTitle})}}:{text:s.caption,instagramData:{type:'REEL',autoPublish:true,showReelOnFeed:true,isAiGenerated:true,collaborators:s.collaborators.map(username=>({username,deleted:false}))}}
}
/** Metadata evidence only, not a publication receipt or proof collaborators accepted. */
export function readbackCafeMetadata(value:unknown,post:unknown){
 const s=validateCafeMetadata(value),p=object(post),data=object(p[s.network==='facebook'?'facebookData':'instagramData'])
 if(p.text!==s.caption||data.type!=='REEL')fail()
 if(s.network==='instagram'){
  if(data.autoPublish!==true||data.showReelOnFeed!==true||data.isAiGenerated!==true||!Array.isArray(data.collaborators)||data.collaborators.length!==s.collaborators.length)fail()
  const observed=(data.collaborators as unknown[]).map(v=>{const c=object(v);if(c.deleted!==false||typeof c.username!=='string')fail();return c.username})
  if(new Set(observed).size!==observed.length||s.collaborators.some(h=>!observed.includes(h)))fail()
 } else {
  if(s.facebookTitle===null?data.title!==undefined&&data.title!==null&&data.title!=='':data.title!==s.facebookTitle)fail()
  if(data.collaborators!==undefined&&(!Array.isArray(data.collaborators)||data.collaborators.length))fail()
 }
 return {metadataDigest:cafeMetadataDigest(s),metadataMatched:true as const,collaborationStatus:s.collaborationStatus,acceptanceVerified:false as const,publicationVerified:false as const}
}
