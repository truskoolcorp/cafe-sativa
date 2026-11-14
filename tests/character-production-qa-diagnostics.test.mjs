import test from 'node:test';import assert from 'node:assert/strict'
import {qaFailureReason,qaHeldMessage,safeQaDiagnostic} from '../lib/content/character-production-qa-diagnostics.ts'
test('only exact local errors map to fixed reason codes',()=>{
 for(const [m,r] of [['QA persistence unconfirmed','persistence_unconfirmed'],['Private bucket required','private_bucket_required'],['Streaming storage capability required','stream_capability_missing'],['Private stream unavailable','stream_unavailable'],['Private storage deadline exceeded','deadline_exceeded'],['QA bytes mismatch','bytes_mismatch'],['QA target not enrolled','target_rejected'],['QA scope rejected','scope_rejected']])assert.equal(qaFailureReason(Error(m)),r)
 for(const e of [Error('https://secret/token'),{message:'QA bytes mismatch'},Error('QA bytes mismatch secret'),Error('constructor')])assert.equal(qaFailureReason(e),'operation_unconfirmed')
})
test('UI displays only validated fixed diagnostic values',()=>{
 const d={phase:'source_read',reason:'deadline_exceeded',elapsedMs:8000};assert.match(qaHeldMessage(d),/source_read; reason: deadline_exceeded; elapsed: 8000 ms/)
 for(const v of [{...d,phase:'https://secret'}, {...d,reason:'secret'}, {...d,elapsedMs:Infinity},{...d,elapsedMs:60001},null]){assert.equal(safeQaDiagnostic(v),null);assert.doesNotMatch(qaHeldMessage(v),/secret|Phase:/)}
})
