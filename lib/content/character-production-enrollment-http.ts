export type EnrollmentPhase='plan'|'work'|'qa'
export interface EnrollmentHttpRuntime {
 planner:{run(header:string|null,signal:AbortSignal):Promise<{status:string}>};
 worker(request:Request):Promise<Response>;
 qa(request:Request):Promise<Response>;
}
/** Phase chosen by server route, never request payload. No enrollment/credential fallback. */
export function createEnrollmentHttpHandler(phase:EnrollmentPhase,authorize:(header:string|null)=>boolean,
 runtime:EnrollmentHttpRuntime|null){
 if(!['plan','work','qa'].includes(phase))throw Error('Unknown enrolled phase')
 const response=(code:number,status:string)=>Response.json({status},{status:code,headers:{'Cache-Control':'private, no-store'}})
 return async(request:Request):Promise<Response>=>{
  if(!authorize(request.headers.get('authorization')))return response(401,'unauthorized')
  if(request.method!=='GET')return response(405,'method_not_allowed')
  if(new URL(request.url).search)return response(400,'unexpected_parameters')
  if(!runtime)return response(503,'unconfigured')
  if(request.signal.aborted)return response(503,'held')
  try{
   if(phase==='work')return await runtime.worker(request)
   if(phase==='qa')return await runtime.qa(request)
   const result=await runtime.planner.run(request.headers.get('authorization'),request.signal)
   if(request.signal.aborted)return response(503,'held')
   if(!['disabled','unauthorized','idle','blocked','held','planned'].includes(result.status))return response(503,'held')
   return response(result.status==='unauthorized'?401:['idle','planned'].includes(result.status)?200:503,result.status)
  }catch{return response(503,'held')}
 }
}
