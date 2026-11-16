import type {ProductionRpc} from './character-production-store.ts'
type Result={data:unknown;error:unknown}
export interface ProductionServerRpcClient {
 rpc(name:string,args:Record<string,unknown>):{abortSignal(signal:AbortSignal):{retry(enabled:false):PromiseLike<Result>}}
}
/** Exact production SDK boundary. No credentials, write retries or caller SQL. */
export function createServerProductionRpc(db:ProductionServerRpcClient,signal:AbortSignal):ProductionRpc {
 const allowed=['claim','submitted','observe_receipt','unknown','pending','failed','output_status','output','due','authorization','broker_authorized'].map(n=>'character_production_'+n)
 return {rpc(name,args){
  if(signal.aborted||!allowed.includes(name))throw Error('Production RPC scope rejected')
  return db.rpc(name,args).abortSignal(signal).retry(false)
 }}
}
