import { performance } from 'node:perf_hooks'
import { heyGenBindingRevision } from './character-production-provider-heygen.ts'
import type { ApprovedAvatar, HeyGenConfig } from './character-production-provider-heygen.ts'

/** Read-only connector transport. No discovery-driven enrollment or writes. */
export interface HeyGenInventoryTransport {
  list_avatar_looks(args:Readonly<{link_id:string;ownership:'private';limit:50;token?:string}>,signal:AbortSignal):Promise<unknown>;
  list_voices(args:Readonly<{link_id:string;type:'private';limit:100;token?:string}>,signal:AbortSignal):Promise<unknown>;
}
type Page={items:Record<string,unknown>[];has_more:boolean;next_token:string|null}
function page(raw:unknown):Page {
  if(!raw||typeof raw!=='object')throw Error('Invalid inventory envelope')
  const r=raw as Record<string,unknown>
  if(r.isError!==false||!Array.isArray(r.content)||r.content.length<1||r.content.length>8)throw Error('Invalid inventory envelope')
  // Connector may append human display guidance. Treat it only as inert text;
  // never execute it or merge it into the authoritative JSON inventory.
  let total=0
  const documents:unknown[]=[]
  for(const c of r.content){
    if(!c||typeof c!=='object'||c.type!=='text'||typeof c.text!=='string')throw Error('Invalid inventory content')
    total+=Buffer.byteLength(c.text,'utf8');if(total>1_000_000)throw Error('Inventory content too large')
    const value=c.text.trim()
    if(value.startsWith('{')||value.startsWith('['))documents.push(JSON.parse(value))
  }
  if(documents.length!==1)throw Error('Ambiguous inventory document')
  const p=documents[0] as Record<string,unknown>
  if(!p||typeof p!=='object'||Array.isArray(p)||!Array.isArray(p.items)||p.items.length>100||typeof p.has_more!=='boolean'||
    p.items.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('Invalid inventory page')
  const token=p.next_token
  if(p.has_more?(typeof token!=='string'||token.length<1||token.length>2048):!(token===null||token===undefined||token===''))throw Error('Invalid inventory cursor')
  return {items:p.items as Record<string,unknown>[],has_more:p.has_more,next_token:typeof token==='string'?token:null}
}
/** Config and expected binding are snapshots; account/model/IDs are never inferred
 * from names or provider suggestions. Both resources must be exact private IDs. */
export function createHeyGenBindingVerifier(config:Pick<HeyGenConfig,'linkId'|'model'|'aspectRatio'>,transport:HeyGenInventoryTransport,budgetMs=8000):(binding:ApprovedAvatar)=>Promise<boolean> {
  const c=Object.freeze({...config}),looks=transport.list_avatar_looks.bind(transport),voices=transport.list_voices.bind(transport)
  return async input=>{
    const binding=Object.freeze({...input})
    if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>120000)return false
    const deadline=performance.now()+budgetMs,controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>|undefined
    const current=()=>{if(controller.signal.aborted||performance.now()>=deadline)throw Error('Inventory deadline exceeded')}
    async function scan(kind:'look'|'voice') {
      let token:string|undefined,found=0,valid=false
      const seenTokens=new Set<string>()
      for(let index=0;index<5;index++) {
        current()
        const args=kind==='look'?Object.freeze({link_id:c.linkId,ownership:'private' as const,limit:50 as const,...(token?{token}:{})}):
          Object.freeze({link_id:c.linkId,type:'private' as const,limit:100 as const,...(token?{token}:{})})
        const raw=kind==='look'?await looks(args as Parameters<HeyGenInventoryTransport['list_avatar_looks']>[0],controller.signal):
          await voices(args as Parameters<HeyGenInventoryTransport['list_voices']>[0],controller.signal)
        current();const p=page(raw);current()
        for(const item of p.items) {
          if(kind==='look'&&item.id===binding.avatarId) {
            found++
            valid=item.status==='completed'&&(item.error===null||item.error===undefined)&&
              (item.error_code===null||item.error_code===undefined)&&(item.error_message===null||item.error_message===undefined)&&
              Array.isArray(item.supported_api_engines)&&item.supported_api_engines.includes(c.model)
          }
          if(kind==='voice'&&item.voice_id===binding.voiceId){found++;valid=item.status==='ACTIVE'}
        }
        if(found>1)return false
        current()
        if(!p.has_more)return found===1&&valid
        if(!p.next_token||seenTokens.has(p.next_token))return false
        seenTokens.add(p.next_token);token=p.next_token
      }
      return false // Incomplete bounded inventory is not proof of availability.
    }
    try {
      heyGenBindingRevision(c,binding) // Pure validation; no malformed IDs reach reads.
      return await Promise.race([
        (async()=>{const look=await scan('look');current();if(!look)return false
          const voice=await scan('voice');current();return voice})(),
        new Promise<boolean>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(false)},budgetMs)}),
      ])
    }catch{return false}finally{clearTimeout(timer);controller.abort()}
  }
}
