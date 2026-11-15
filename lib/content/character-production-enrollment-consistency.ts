import {createHash} from 'node:crypto'
import {canonicalImageDigest,imageApprovedAvatar} from './character-production-canonical-image.ts'
import {heyGenBindingRevision} from './character-production-provider-heygen.ts'
import type {ReviewedPlannerEnrollment} from './character-production-planner-entry.ts'
import type {InternalProductionManifest} from './character-production-server-composition.ts'
/** Configuration consistency only, not rights, current quote, bytes or perceptual QA.
 * Fail before planning a durable slot that the supplied worker cannot execute. */
export function assertEnrollmentRuntimeConsistency(e:ReviewedPlannerEnrollment,w:InternalProductionManifest):void {
 const p=e.manifest,c=w.configuration
 if(p.expectedUsername!==w.expectedHeyGenUsername||p.heygen.linkId!==c.heygen.linkId||p.heygen.model!==c.heygen.model||p.heygen.aspectRatio!==c.heygen.aspectRatio)throw Error('Planner/worker account or format mismatch')
 if(!p.candidates.length||p.candidates.length>32)throw Error('Invalid finite candidate set')
 // Validate all supplied proofs, even unused ones; never repair/fabricate bindings.
 const images=w.images.map(image=>({image,digest:canonicalImageDigest(image),revision:heyGenBindingRevision(c.heygen,imageApprovedAvatar(image))}))
 const plans=p.images.map(proof=>({proof,digest:canonicalImageDigest(proof.image)}))
 for(const input of p.candidates){
  const s=input.slot,scriptHash=createHash('sha256').update(s.script).digest('hex')
  if(s.provider!==c.engine.provider||s.model!==c.engine.model||!c.engine.characters.includes(s.characterId))throw Error('Worker candidate scope mismatch')
  const matches=images.filter(({image:i,revision})=>i.characterId===s.characterId&&i.canonicalRevision===s.canonicalRevision&&i.portraitSha256===s.portraitSha256&&i.audio.voiceId===s.voiceId&&i.audio.scriptSha256===scriptHash&&revision===s.providerBindingRevision)
  if(matches.length!==1)throw Error('Missing or ambiguous worker image/audio binding')
  const selected=matches[0]
  const planned=plans.filter(({proof:m,digest})=>digest===selected.digest&&m.themes.includes(input.theme)&&m.quoteCents===s.quoteCents&&m.durationSeconds===s.durationSeconds)
  if(planned.length!==1)throw Error('Planner/worker media or quote mismatch')
  const avatar=imageApprovedAvatar(selected.image)
  if(c.heygen.bindings.filter(b=>b.characterId===s.characterId).length!==1)throw Error('Ambiguous character provider binding')
  const configured=c.heygen.bindings.filter(b=>b.characterId===avatar.characterId&&b.canonicalRevision===avatar.canonicalRevision&&b.portraitSha256===avatar.portraitSha256&&b.voiceId===avatar.voiceId&&b.avatarId===avatar.avatarId&&b.audioBindingSha256===avatar.audioBindingSha256&&b.imageBindingSha256===avatar.imageBindingSha256)
  if(configured.length!==1)throw Error('Missing or ambiguous worker provider binding')
 }
}
