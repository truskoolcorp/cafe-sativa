import {approvedAsset,CanonicalAsset} from './policy'
type Character={id:string;name:string;production_ready?:boolean;blockers?:string[]}
type Glyph={live?:boolean;characters:Character[]}
export const PROGRAM_REFERENCES=[
 {category:'stage',room:'stage',cast:['ahnika-merlot','laviche-fea'],checks:['Approved episode brief and performer material']},
 {category:'kitchen',room:'kitchen',cast:['chef-v'],checks:['Confirm Chef V as the first guest','Approved recipe, script and hostwear']},
 {category:'cigar_lounge',room:'cigar_lounge',cast:['laviche-fea'],checks:['Verified product details and approved tasting script']},
 {category:'bar',room:'bar',cast:[],checks:['Approved clip and caption before release']},
 {category:'gallery',room:'gallery',cast:[],checks:['Actual artwork, attribution and usage permission']},
 {category:'community',room:'community',cast:['keith','laviche-fea'],checks:['Approved long-table setting and conversation brief']},
] as const
export function programReferenceStatus(assets:CanonicalAsset[],glyph:Glyph){
 return PROGRAM_REFERENCES.map(program=>{
  const room=assets.find(a=>a.kind==='venue'&&a.subject===program.room&&approvedAsset(a))
  const missing:string[]=[]
  if(!room)missing.push(`Approve the ${program.room.replaceAll('_',' ')} room master`)
  const cast=program.cast.map(id=>{
   const c=glyph.live===true?glyph.characters.find(c=>c.id===id):null
   if(!c)missing.push(`Verify ${id.replaceAll('-',' ')} in the live GLYPH registry`)
   else if(c.production_ready!==true)missing.push(`Resolve ${c.name}'s canonical checks in Master References`)
   return {id,name:c?.name||id,ready:c?.production_ready===true&&glyph.live===true}
  })
  return {category:program.category,room:program.room,roomApproved:Boolean(room),cast,referenceChecksPassed:missing.length===0,missing,episodeChecks:program.checks,productionStatus:program.category==='bar'?'Approved bar pilot uses the existing release workflow':'Character/episode video production is not connected yet'}
 })
}
