import {createHeyGenBindingVerifier} from './character-production-provider-inventory.ts'
import type {HeyGenInventoryTransport} from './character-production-provider-inventory.ts'
import {createCharacterProductionEngine,productionSlotDigest} from './character-production-engine.ts'
import {createBrokeredProductionStore} from './character-production-scoped.ts'
import type {OutputBroker} from './character-production-scoped.ts'
import type {ProductionStore,EngineConfig,ProductionSlot} from './character-production-engine.ts'
import {createPostgresProductionStore} from './character-production-store.ts'
import type {ProductionRpc,PrivateObjects} from './character-production-store.ts'
import {createGenerationValidator} from './character-production-canon.ts'
import type {GenerationAuthorization,GenerationValidationSources} from './character-production-canon.ts'
import {createHeyGenProductionProvider,validateHeyGenProductionConfig,heyGenBindingRevision} from './character-production-provider-heygen.ts'
import type {ApprovedAvatar,HeyGenConfig,HeyGenTransport,HeyGenCodecs} from './character-production-provider-heygen.ts'
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function createGenerationAuthorizationReader(rpc:ProductionRpc,now:()=>number){
 return async(key:string,id:string,signal:AbortSignal):Promise<GenerationAuthorization|null>=>{
  if(signal.aborted)return null
  const started=now()
  try{
   const r=await rpc.rpc('character_production_authorization',{p_key:key,p_authorization_id:id})
   if(signal.aborted||r.error||!object(r.data))return null
   const d=r.data,s=d.slot
   if(!object(s)||s.key!==key||s.authorizationId!==id||d.enabled!==true||typeof d.revision!=='string'||!d.revision||!Number.isSafeInteger(d.observedAt)||(d.observedAt as number)<started||(d.observedAt as number)>now()||typeof d.digest!=='string'||productionSlotDigest(s as ProductionSlot)!==d.digest||!Number.isSafeInteger(s.authorizationExpiresAt))return null
   return {id,digest:d.digest,revision:d.revision,enabled:true,expiresAt:s.authorizationExpiresAt as number}
  }catch{return null}
 }
}
export type CharacterProductionRuntimeConfig={engine:EngineConfig;heygen:HeyGenConfig}
export type CharacterProductionRuntimeDependencies={rpc:ProductionRpc;storage:PrivateObjects;transport:HeyGenTransport;inventoryTransport?:HeyGenInventoryTransport;verifyBinding?:(binding:ApprovedAvatar)=>Promise<boolean>;codecs:HeyGenCodecs;readCanon:GenerationValidationSources['readCanon'];normalizeCanon:GenerationValidationSources['normalizeCanon']}
/** No clients, credentials, route or scheduler by default. Current live canonical
 * source and existing upstream normalizer must be explicitly supplied. */
type CommonDependencies=Omit<CharacterProductionRuntimeDependencies,'storage'>
export type BrokeredProductionRuntimeDependencies=CommonDependencies&{outputBroker:OutputBroker}
export function createCharacterProductionRuntime(configuration:CharacterProductionRuntimeConfig|null=null,open?:()=>CharacterProductionRuntimeDependencies){
 const max=configuration?.engine.maxVideoBytes??12
 return composeRuntime(configuration,open?()=>{const d=open();return {...d,store:createPostgresProductionStore(d.rpc,d.storage,{bucket:'character-production-private',maxVideoBytes:max})}}:undefined)
}
/** Isolated runtime option: generator has no direct Storage dependency; only the
 * authenticated output broker may upload/readback/attest pending-QA media. */
export function createBrokeredCharacterProductionRuntime(configuration:CharacterProductionRuntimeConfig|null=null,open?:()=>BrokeredProductionRuntimeDependencies){
 if(configuration&&(configuration.engine.maxVideoBytes<16||configuration.engine.maxVideoBytes>35*1024*1024))throw Error('Broker media cap mismatch')
 return composeRuntime(configuration,open?()=>{const d=open();return {...d,store:createBrokeredProductionStore(d.rpc,d.outputBroker)}}:undefined)
}
function composeRuntime(configuration:CharacterProductionRuntimeConfig|null,open?:()=>CommonDependencies&{store:ProductionStore}){
 if(configuration===null)return createCharacterProductionEngine({enabled:false,provider:'heygen',model:'disabled',maxVideoBytes:12,characters:[],now:Date.now},()=>{throw Error('Disabled runtime')})
 const config={engine:{...configuration.engine,characters:[...configuration.engine.characters]},heygen:{...configuration.heygen,bindings:configuration.heygen.bindings.map(b=>({...b})),mediaOrigins:[...configuration.heygen.mediaOrigins]}}
 if((config.engine.enabled===true)!==(config.heygen.enabled===true)||config.engine.provider!=='heygen'||config.engine.model!==config.heygen.model||config.engine.maxVideoBytes!==config.heygen.maxVideoBytes)throw Error('Runtime provider configuration mismatch')
 return createCharacterProductionEngine(config.engine,()=>{
  validateHeyGenProductionConfig(config.heygen);if(!open)throw Error('Missing dependencies');const d=open()
  if(!d.verifyBinding&&!d.inventoryTransport)throw Error('Verified inventory required')
  const inventory=d.verifyBinding??createHeyGenBindingVerifier(config.heygen,d.inventoryTransport!)
  const canon=createGenerationValidator({now:config.engine.now,readAuthorization:createGenerationAuthorizationReader(d.rpc,config.engine.now),readCanon:d.readCanon,normalizeCanon:d.normalizeCanon})
  return {store:d.store,provider:createHeyGenProductionProvider(config.heygen,d.transport,d.codecs),validateCurrent:async slot=>{
   const b=config.heygen.bindings.find(b=>b.characterId===slot.characterId)
   if(!b||b.canonicalRevision!==slot.canonicalRevision||b.voiceId!==slot.voiceId||b.portraitSha256!==slot.portraitSha256||heyGenBindingRevision(config.heygen,b)!==slot.providerBindingRevision)return false
   return await inventory(b)&&await canon(slot)
  }}
 })
}
