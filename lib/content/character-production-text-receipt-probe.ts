/** Negative probe of the reviewed receipt endpoint. All-null parameters are
 * rejected before SQL reads/writes. This verifies reachability/permission only,
 * not future storage success or provider authenticity. No fallback or retry. */
export async function probeTextReceipt(rpc:(args:Record<string,null>)=>PromiseLike<{data:unknown;error:unknown}>):Promise<boolean>{
 try{
  const r=await rpc({p_key:null,p_token:null,p_digest:null,p_provider_id:null,p_request_id:null,p_model:null,p_stop_reason:null,p_input_tokens:null,p_output_tokens:null,p_response_sha256:null})
  return r.error===null&&r.data===false
 }catch{return false}
}

/** Same no-mutation probe for separately approved private content checkpoint. */
export async function probeTextCheckpoint(rpc:(args:Record<string,null>)=>PromiseLike<{data:unknown;error:unknown}>):Promise<boolean>{
 return probeTextReceipt(args=>rpc({...args,p_content_json:null}))
}
