import {createCharacterProductionEngine} from './character-production-engine.ts'
import type {EngineConfig} from './character-production-engine.ts'
import {createPostgresProductionStore} from './character-production-store.ts'
import type {ProductionRpc,PrivateObjects} from './character-production-store.ts'
import {createGenerationValidator} from './character-production-canon.ts'
import type {GenerationValidationSources} from './character-production-canon.ts'
import {createGenerationAuthorizationReader} from './character-production-runtime.ts'
import {createCanonicalAudioSlotValidator,createHeyGenAudioProductionProvider,validateHeyGenAudioProductionConfig} from './character-production-provider-heygen-audio.ts'
import type {HeyGenAudioConfig,HeyGenAudioTransport,CanonicalAudioVerifier} from './character-production-provider-heygen-audio.ts'
import type {HeyGenCodecs} from './character-production-provider-heygen.ts'
export type AudioRuntimeConfig={engine:EngineConfig;heygen:HeyGenAudioConfig}
export type AudioRuntimeDependencies={rpc:ProductionRpc;storage:PrivateObjects;transport:HeyGenAudioTransport;codecs:HeyGenCodecs;verifier:CanonicalAudioVerifier;readCanon:GenerationValidationSources['readCanon'];normalizeCanon:GenerationValidationSources['normalizeCanon']}
/** Only consumes already-authorized immutable canonical audio. No synthesis,
 * upload, scheduling, credential discovery or publication is performed here.
 * verifier must establish exact live look capability and durable source/transfer
 * provenance; canonical and generation authority are independently reread. */
export function createCharacterAudioRuntime(configuration:AudioRuntimeConfig|null=null,open?:()=>AudioRuntimeDependencies){
 if(configuration===null)return createCharacterProductionEngine({enabled:false,provider:'heygen',model:'disabled',maxVideoBytes:12,characters:[],now:Date.now},()=>{throw Error('Disabled runtime')})
 const config={engine:{...configuration.engine,characters:[...configuration.engine.characters]},heygen:{...configuration.heygen,mediaOrigins:[...configuration.heygen.mediaOrigins],clips:configuration.heygen.clips.map(c=>({avatar:{...c.avatar},audio:{...c.audio}}))}}
 if((config.engine.enabled===true)!==(config.heygen.enabled===true)||config.engine.provider!=='heygen'||config.engine.model!==config.heygen.model||config.engine.maxVideoBytes!==config.heygen.maxVideoBytes)throw Error('Audio runtime configuration mismatch')
 return createCharacterProductionEngine(config.engine,()=>{
  validateHeyGenAudioProductionConfig(config.heygen)
  if(!open)throw Error('Missing audio dependencies')
  const d=open()
  const canon=createGenerationValidator({now:config.engine.now,readAuthorization:createGenerationAuthorizationReader(d.rpc,config.engine.now),readCanon:d.readCanon,normalizeCanon:d.normalizeCanon})
  const verifier:CanonicalAudioVerifier={validateCurrent:async(receipt,slot,signal)=>{
   if(signal.aborted||await d.verifier.validateCurrent(receipt,slot,signal)!==true||signal.aborted)return false
   return await canon(slot)&&!signal.aborted
  }}
  const audio=createCanonicalAudioSlotValidator(config.heygen,verifier)
  return {store:createPostgresProductionStore(d.rpc,d.storage,{bucket:'character-production-private',maxVideoBytes:config.engine.maxVideoBytes}),provider:createHeyGenAudioProductionProvider(config.heygen,d.transport,d.codecs,verifier),validateCurrent:async slot=>await canon(slot)&&await audio(slot)}
 })
}
