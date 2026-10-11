import { liveGlyphCharacters,glyphPortrait } from '@/lib/content/glyph-live'
export const PUBLIC_HOST_CHARACTERS={laviche:'laviche-fea',ginger:'ginger',ahnika:'ahnika-merlot'} as const
export async function approvedHostPortrait(host:string) {
  if(!Object.prototype.hasOwnProperty.call(PUBLIC_HOST_CHARACTERS,host))return null
  const id=PUBLIC_HOST_CHARACTERS[host as keyof typeof PUBLIC_HOST_CHARACTERS]
  const source=await liveGlyphCharacters()
  const character=source.characters.find((row:any)=>row.id===id)
  if(source.live!==true || !character?.production_ready || character.rights_status!=='approved' || !character.primary_asset_id || !character.sha256)return null
  return glyphPortrait(id,character.primary_asset_id,character.sha256)
}
