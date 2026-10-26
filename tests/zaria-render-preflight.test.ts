import { test } from "node:test";
import { strict as assert } from "node:assert";
import { requireZariaRenderApproval } from "../lib/content/zaria-render-preflight.ts";
test("denies incomplete Zaria approval",()=>{
 for(const key of ["galleryApproved","voiceApproved","ownerAuthorized"] as const){
  const approval={galleryApproved:true,voiceApproved:true,ownerAuthorized:true};
  approval[key]=false;
  assert.throws(()=>requireZariaRenderApproval(approval),/ZARIA_RENDER_NOT_APPROVED/);
 }
});
test("passes only when all approvals are explicitly true",()=>assert.doesNotThrow(()=>requireZariaRenderApproval({galleryApproved:true,voiceApproved:true,ownerAuthorized:true})));
