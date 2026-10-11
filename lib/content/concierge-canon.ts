import { liveGlyphCharacters } from '@/lib/content/glyph-live'
import { PUBLIC_HOST_CHARACTERS } from '@/lib/content/host-portraits'
export async function canonicalConciergeHost(host:string) {
  if(!Object.prototype.hasOwnProperty.call(PUBLIC_HOST_CHARACTERS,host))return null
  const source=await liveGlyphCharacters()
  const id=PUBLIC_HOST_CHARACTERS[host as keyof typeof PUBLIC_HOST_CHARACTERS]
  const row=source.characters.find((c:any)=>c.id===id)
  if(source.live!==true || row?.production_ready!==true || row.rights_status!=='approved' || !row.canonical_context || row.voice_status!=='canonical' || !row.voice_id)return null
  return {id:row.id,context:row.canonical_context,voiceId:row.voice_id}
}
