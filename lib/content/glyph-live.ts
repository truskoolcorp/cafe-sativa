import {createHash} from 'node:crypto'
import {readBoundedPublicChatJson} from './public-chat-readiness-resources'
import {GLYPH_CHARACTER_SNAPSHOT} from './glyph-characters'
const SOURCE='https://studio.truskool.net/api/studios/cafe-sativa-canon'
const allowed=new Set<string>([...GLYPH_CHARACTER_SNAPSHOT.characters.map(c=>c.id),'zaria-solenne'])
export async function readGlyph(path='', signal?: AbortSignal) {
 const secret=process.env.GLYPH_CANON_READ_TOKEN
 if(!secret)throw Error('GLYPH live connection not configured')
 return fetch(`${SOURCE}${path}`,{headers:{Authorization:`Bearer ${secret}`},cache:'no-store',redirect:'error',signal:signal ?? AbortSignal.timeout(25000)})
}
export async function liveGlyphCharacters(signal?: AbortSignal) {
 const r=await readGlyph('', signal);if(!signal&&!r.ok)throw Error('GLYPH live source unavailable')
 const b=signal ? await readBoundedPublicChatJson(r, signal) as {live:unknown;characters:unknown[]} : await r.json()
 if(b.live!==true||!Array.isArray(b.characters)||b.characters.length>allowed.size)throw Error('Invalid canonical source response')
 return {...b,characters:b.characters.filter((c:{id:string})=>allowed.has(c.id)).map((c:{id:string;primary_asset_id:string|null;portrait_available:boolean})=>({...c,portrait_url:c.portrait_available&&c.primary_asset_id?`/api/content/glyph/portrait?characterId=${encodeURIComponent(c.id)}&assetId=${encodeURIComponent(c.primary_asset_id)}`:null}))}
}
export async function glyphPortrait(id:string,assetId:string,expectedSha?:string) {
 if(!allowed.has(id)||! /^[a-f0-9-]{36}$/.test(assetId))return null
 const r=await readGlyph(`?characterId=${encodeURIComponent(id)}&assetId=${encodeURIComponent(assetId)}`)
 if(!r.ok)return null
 const mime=r.headers.get('content-type')?.split(';')[0],sha=r.headers.get('x-canonical-sha256')
 if(!mime||!['image/png','image/jpeg','image/webp'].includes(mime)||!sha||!r.body)throw Error('Invalid canonical portrait')
 const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0
 while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>10000000){await reader.cancel();throw Error('Portrait too large')}parts.push(p.value)}
 const bytes=Buffer.concat(parts)
 if((expectedSha && expectedSha!==sha) || createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('Canonical portrait integrity failed')
 return {bytes,mime}
}
