import { liveGlyphCharacters,glyphPortrait } from '@/lib/content/glyph-live'
import { approvedZariaPortrait,zariaPortraitEnabled } from '@/lib/gallery/zaria'
export const PUBLIC_HOST_CHARACTERS={laviche:'laviche-fea',ginger:'ginger',ahnika:'ahnika-merlot',zaria:'zaria-solenne'} as const
export async function approvedHostPortrait(host:string) {
  if(!Object.prototype.hasOwnProperty.call(PUBLIC_HOST_CHARACTERS,host))return null
  if(host==='zaria'&&!zariaPortraitEnabled())return null
  const id=PUBLIC_HOST_CHARACTERS[host as keyof typeof PUBLIC_HOST_CHARACTERS]
  const source=await liveGlyphCharacters()
  const character=source.characters.find((row:any)=>row.id===id)
  if(source.live!==true || !character?.production_ready || character.rights_status!=='approved' || !character.primary_asset_id || !character.sha256)return null
  if(host==='zaria'&&!approvedZariaPortrait(character))return null
  return glyphPortrait(id,character.primary_asset_id,character.sha256)
}
