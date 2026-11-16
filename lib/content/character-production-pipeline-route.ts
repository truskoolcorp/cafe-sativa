import 'server-only'
import {waitUntil} from '@vercel/functions'
import {cronAuthorized} from './auth'
import {createCafePipelineEntry} from './character-production-pipeline-entry'
import {openCafePipelineConnection} from './character-production-pipeline-connection'
import type {InternalProductionManifest} from './character-production-server-composition'
/** No live baseline. A separately reviewed code-owned account/model/limits
 * manifest is required; no request/environment JSON can configure this route. */
const reviewedManifest:InternalProductionManifest|null=null
const compose=(manifest:InternalProductionManifest|null)=>manifest?createCafePipelineEntry({manifest,open:openCafePipelineConnection,authorize:cronAuthorized,retain:waitUntil}):null
const handler=compose(reviewedManifest)
export async function cafePipelineGET(request:Request){
 if(request.method!=='GET'||request.body!==null||new URL(request.url).search)return Response.json({status:'unsupported'},{status:405})
 if(!cronAuthorized(request.headers.get('authorization')))return Response.json({status:'unauthorized'},{status:401})
 if(!handler)return Response.json({status:'unconfigured',publicationVerified:false},{status:503,headers:{'Cache-Control':'private, no-store'}})
 return handler(request)
}
