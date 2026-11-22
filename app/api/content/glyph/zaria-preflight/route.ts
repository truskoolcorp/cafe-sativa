import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isContentAdmin } from "@/lib/content/auth";
import { zariaJobSubmissionBlockers } from "@/lib/content/zaria-job-submission-blockers";
import { zariaPrivateRenderBlockers, zariaPublicationBlockers } from "@/lib/content/zaria-dispatch-readiness";
import { verifiedPrivateCharacterAsset, ZARIA_CHARACTER_ASSETS } from "@/lib/private-character-assets";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const expected: ReadonlyArray<readonly [string,string]> = [
 ["zaria-solenne/approved/front-facial-master.jpeg","47b8fe1775ecafd05961cffffa317db0c17aee0da068dfa9cd414f85dc39f25d"],
 ["zaria-solenne/approved/three-quarter.jpeg","264bfbf3783c78b802adf8ec9e827b9badc14f0ac288fe2ab4314ef72340e30d"],
 ["zaria-solenne/approved/full-body.jpeg","ec07d605f327ae9066837e4faa69c36d1ff080a21a66e59af03e732933e8bad2"],
 ["zaria-solenne/approved/side-alt.jpeg","67d01f197438d26473e0228998f03f7480f8493e03c7e30773e368fdc3fed5e9"],
 ["zaria-solenne/approved/side-clean.jpeg","c219dabe2822d0a6a756d197c7da9aead285931598b65717f3f62502f2588a5a"],
 ["zaria-solenne/venue-references/gallery-candidate.png","c48c1e9869b6736da21ee2a45e5ea710a8d44afa4620d3af1188f8af89ddde82"],
 ["zaria-solenne/manifests/asset-manifest.json","6cbb8e41046d88a2edbb42511107df514e4d322e82344a649a135fb821b8eb34"]
];
export async function GET(){
 if (!await isContentAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401,headers:{"Cache-Control":"no-store"}});
 const db=createClient(); const checks: Array<{path:string;valid:boolean;reason?:string}>=[];
 for(const [path,sha] of expected){
   try { await verifiedPrivateCharacterAsset(db,path,sha); checks.push({path,valid:true}); }
   catch(e) {checks.push({path,valid:false,reason:e instanceof Error?e.message:"ASSET_CHECK_FAILED"});}
 }
 const valid=checks.every(x=>x.valid);
 const {data:job,error:jobError}=await db.from("cs_character_video_jobs").select("id,status,provider_task_id,request_key,provider,budget_cap_usd,budget_approved_at,budget_approved_by").eq("request_key","zaria-gallery-facebook-intro-20261025").maybeSingle();
 const {data:draft,error:draftError}=await db.from("cs_character_promo_drafts").select("status,voice_approved_at,video_qa_approved_at,publication_approved_at,evidence").eq("promo_key","zaria-gallery-facebook-intro-20261025").maybeSingle();
 const renderBlockers=draftError?["DRAFT_READ_FAILED"]:zariaPrivateRenderBlockers(draft,valid);
 renderBlockers.push(...zariaJobSubmissionBlockers(jobError?null:job));
 const publicationBlockers=draftError?["DRAFT_READ_FAILED"]:zariaPublicationBlockers(draft);
 // Read-only preflight does not approve, render, schedule or publish.
 return NextResponse.json({character:"zaria-solenne",bucket:ZARIA_CHARACTER_ASSETS.bucket,integrityVerified:valid,venueCompositionApproved:false,renderAuthorized:renderBlockers.length===0,publishAuthorized:publicationBlockers.length===0 && renderBlockers.length===0,renderBlockers,publicationBlockers,job:job?{id:job.id,status:job.status,requestKey:job.request_key,providerSubmitted:!!job.provider_task_id}:null,checks},{status:valid && !draftError?200:409,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
