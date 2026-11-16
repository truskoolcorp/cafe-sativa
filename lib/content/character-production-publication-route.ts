import 'server-only'
import {cronAuthorized} from './auth'
import {createCafePublicationRuntime} from './character-production-publication-runtime'
/** Flags cannot supply a capability or create policy. Replace only by a
 * separately reviewed code-owned opener; never parse request IDs/credentials. */
const reviewedConfiguration:Parameters<typeof createCafePublicationRuntime>[0]|null=null
const runtime=reviewedConfiguration?createCafePublicationRuntime(reviewedConfiguration):null
export async function cafePublicationGET(request:Request):Promise<Response>{
 if(request.method!=='GET'||new URL(request.url).search||request.body!==null)return Response.json({status:'unsupported'},{status:405})
 if(!cronAuthorized(request.headers.get('authorization')))return Response.json({status:'unauthorized'},{status:401})
 if(!runtime)return Response.json({status:'unconfigured',publicationVerified:false},{status:503,headers:{'Cache-Control':'private, no-store'}})
 return runtime(request)
}
