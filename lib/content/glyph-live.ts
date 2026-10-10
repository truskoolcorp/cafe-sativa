import {createHash} from 'node:crypto'
import {GLYPH_CHARACTER_SNAPSHOT} from './glyph-characters'
const SOURCE='https://studio.truskool.net/api/studios/cafe-sativa-canon'
const allowed=new Set<string>(GLYPH_CHARACTER_SNAPSHOT.characters.map(c=>c.id))
export async function readGlyph(path='') {
 const secret=process.env.GLYPH_CANON_READ_TOKEN
 if(!secret)throw Error('GLYPH live connection not configured')
 return fetch(`${SOURCE}${path}`,{headers:{Authorization:`Bearer ${secret}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)})
}
export async function liveGlyphCharacters() {
 const r=await readGlyph();if(!r.ok)throw Error('GLYPH live source unavailable')
 const b=await r.json()
 if(b.live!==true||!Array.isArray(b.characters)||b.characters.length>allowed.size)throw Error('Invalid canonical source response')
 return {...b,characters:b.characters.filter((c:{id:string})=>allowed.has(c.id)).map((c:{id:string;primary_asset_id:string|null;portrait_available:boolean})=>({...c,portrait_url:c.portrait_available&&c.primary_asset_id?`/api/content/glyph/portrait?characterId=${encodeURIComponent(c.id)}&assetId=${encodeURIComponent(c.primary_asset_id)}`:null}))}
}
export async function glyphPortrait(id:string,assetId:string) {
 if(!allowed.has(id)||! /^[a-f0-9-]{36}$/.test(assetId))return null
 const r=await readGlyph(`?characterId=${encodeURIComponent(id)}&assetId=${encodeURIComponent(assetId)}`)
 if(!r.ok)return null
 const mime=r.headers.get('content-type')?.split(';')[0],sha=r.headers.get('x-canonical-sha256')
 if(!mime||!['image/png','image/jpeg','image/webp'].includes(mime)||!sha||!r.body)throw Error('Invalid canonical portrait')
 const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0
 while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>10000000){await reader.cancel();throw Error('Portrait too large')}parts.push(p.value)}
 const bytes=Buffer.concat(parts)
 if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('Canonical portrait integrity failed')
 return {bytes,mime}
}
