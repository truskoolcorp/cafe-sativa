import type {ProductionServerRpcClient} from './character-production-server-rpc'
import type {CafeSemanticBudgetTransport} from './character-promo-cafe-semantic-server'
/** Exact proposed wrappers only, no implicit credential/client creation. Current
 * owner-only SQL denies production service clients until separately reviewed grant. */
export function createCafeSemanticBudgetAdapter(db:ProductionServerRpcClient,lease:CafeSemanticBudgetTransport['lease']):CafeSemanticBudgetTransport{
 const pinned=lease?structuredClone(lease):null
 return {lease:pinned,reserve:async(budgetId,key,inputTokens,signal)=>{
  if(!pinned||pinned.budgetId!==budgetId||pinned.expiresAt<=Date.now()||signal.aborted)return false
  const r=await db.rpc('cs_reserve_cafe_semantic_attempt',{p_budget:budgetId,p_key:key,p_input_tokens:inputTokens}).abortSignal(signal).retry(false)
  return !signal.aborted&&!r.error&&r.data===true
 },receipt:async(input,signal)=>{
  if(!pinned||signal.aborted)return false
  const r=await db.rpc('cs_finish_cafe_semantic_attempt',{p_key:input.key,p_receipt:structuredClone(input)}).abortSignal(signal).retry(false)
  return !signal.aborted&&!r.error&&r.data===true
 }}
}
