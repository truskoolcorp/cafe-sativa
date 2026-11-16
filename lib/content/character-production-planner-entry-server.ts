import 'server-only'
import {cronAuthorized} from './auth'
import {createInternalPlanner} from './character-production-planner-internal-server'
import {createPlannerEntry,type ReviewedPlannerEnrollment} from './character-production-planner-entry'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
/** Factory only: no enrollment instantiated, route registered or cron scheduled.
 * A reviewed scoped client must be supplied explicitly. No credential creation
 * or generic createAdminClient fallback. Existing cron secret remains server-only. */
export function createInternalScopedPlannerEntry(enrollment:ReviewedPlannerEnrollment,openScoped:(signal:AbortSignal)=>ProductionServerRpcClient|null){
 return createPlannerEntry(enrollment,{
  enabled:()=>process.env.CS_CHARACTER_RECURRING_PLANNER_ENABLED==='true',
  authorize:cronAuthorized,
  open:openScoped,
  create:createInternalPlanner,
 })
}
