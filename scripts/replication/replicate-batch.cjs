'use strict'
// Provider-neutral, durable-at-database worker. This module NEVER opens a network
// connection or reaches any external provider by itself. Inject trusted adapters.
// Exactly one in-flight batch per worker; repeated calls are safe to retry.
async function replicateBatch(source,destination,{stream='cafe-sativa',limit=25}={}) {
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid batch size')
 const checkpoint=await destination.readCheckpoint(stream)
 if(!Number.isSafeInteger(checkpoint)||checkpoint<0)throw Error('invalid checkpoint')
 const records=await source.readEvents(stream,checkpoint,limit)
 if(!Array.isArray(records))throw Error('invalid source events')
 let last=checkpoint,applied=0,duplicates=0
 for(const record of records) {
  if(!record || record.stream!==stream || !Number.isSafeInteger(record.sequence_no) ||
      record.sequence_no!==last+1 || !['upsert','delete'].includes(record.action) ||
      !Number.isSafeInteger(record.writer_epoch) || record.writer_epoch<1 ||
      typeof record.event_id!=='string' || typeof record.aggregate_key!=='string')
    throw Error('sequence or source event violation')
  const outcome=await destination.applyEvent(record)
  if(outcome==='applied')applied++
  else if(outcome==='duplicate')duplicates++
  else throw Error('destination did not acknowledge event')
  last=record.sequence_no
 }
 return {stream,from:checkpoint,to:last,applied,duplicates}
}
module.exports={replicateBatch}
