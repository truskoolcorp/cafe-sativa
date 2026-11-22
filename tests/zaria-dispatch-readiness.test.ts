import {test} from "node:test";
import {strict as assert} from "node:assert";
import {zariaPrivateRenderBlockers,zariaPublicationBlockers} from "../lib/content/zaria-dispatch-readiness.ts";
const draft={status:"draft",voice_approved_at:null,video_qa_approved_at:null,publication_approved_at:null,evidence:{private_character_storage:{object_presence_verified:true,byte_hashes_verified:false,candidate_gallery_approved:false,private_render_authorized:false}}};
test("unapproved production draft cannot render even when files pass",()=>{
 const b=zariaPrivateRenderBlockers(draft,true);
 assert.ok(b.includes("GALLERY_CANDIDATE_UNAPPROVED"));
 assert.ok(b.includes("VOICE_UNAPPROVED"));
 assert.ok(b.includes("PRIVATE_RENDER_UNAUTHORIZED"));
});
test("failed real byte verification blocks independent of recorded metadata",()=>{
 const ready={...draft,voice_approved_at:"2026-10-26T00:00:00Z",evidence:{private_character_storage:{object_presence_verified:true,byte_hashes_verified:true,candidate_gallery_approved:true,private_render_authorized:true}}};
 assert.deepEqual(zariaPrivateRenderBlockers(ready,false),["LIVE_ASSET_HASHES_UNVERIFIED"]);
 assert.deepEqual(zariaPrivateRenderBlockers(ready,true),[]);
});
test("publication requires separate video QA and owner publication approval",()=>assert.deepEqual(zariaPublicationBlockers(draft),["VIDEO_QA_UNAPPROVED","PUBLICATION_UNAPPROVED"]));
test("missing draft fails closed",()=>assert.deepEqual(zariaPrivateRenderBlockers(null,true),["DRAFT_MISSING"]));
