import 'server-only'
import {cronAuthorized} from './auth'
import {createEnrollmentHttpHandler,type EnrollmentHttpRuntime} from './character-production-enrollment-http'
/** Deliberately absent. A reviewed finite code-owned manifest and scoped capability
 * must be instantiated here in a subsequent reviewed change. Flags alone cannot
 * configure this runtime. No request/JSON/environment enrollment parsing. */
const reviewedRuntime:EnrollmentHttpRuntime|null=null
export const enrolledPlanGET=createEnrollmentHttpHandler('plan',cronAuthorized,reviewedRuntime)
export const enrolledWorkGET=createEnrollmentHttpHandler('work',cronAuthorized,reviewedRuntime)
export const enrolledQaGET=createEnrollmentHttpHandler('qa',cronAuthorized,reviewedRuntime)
