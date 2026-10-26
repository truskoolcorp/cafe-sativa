import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { resolveCanonicalAsset, CanonicalAssetError } from "../lib/canonical-asset-resolver.ts";

const base = "https://example.supabase.co";
const bytes = new TextEncoder().encode("approved-gallery");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const fileUrl = base + "/storage/v1/object/public/cafe-sativa-canon/reviewed/venue/gallery.jpg";
const originalFetch = globalThis.fetch;
const env = { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: "test-only-key" } as NodeJS.ProcessEnv;
const asset = {id:"asset-1",kind:"venue",subject:"gallery",url:fileUrl,sha256,version:"1",active:true,approved_at:"2026-10-10"};
function install(records:unknown[], data=bytes, status=200) {
  globalThis.fetch = async (input:RequestInfo|URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/rest/v1/")) return Response.json(records);
    return new Response(data, {status});
  };
}
async function throwsCode(code:string) {
  await assert.rejects(()=>resolveCanonicalAsset("venue","gallery",env), (e:unknown)=>e instanceof CanonicalAssetError && e.code===code);
}
test("retrieves and verifies approved master", async()=>{install([asset]);try{const result=await resolveCanonicalAsset("venue","gallery",env);assert.equal(result.sha256,sha256);assert.equal(result.asset.subject,"gallery");}finally{globalThis.fetch=originalFetch;}});
test("missing asset fails closed",async()=>{install([]);try{await throwsCode("NOT_FOUND");}finally{globalThis.fetch=originalFetch;}});
test("duplicate active assets fail closed",async()=>{install([asset,asset]);try{await throwsCode("AMBIGUOUS");}finally{globalThis.fetch=originalFetch;}});
test("corrupted media fails checksum",async()=>{install([asset],new TextEncoder().encode("modified-gallery"));try{await throwsCode("DIGEST_MISMATCH");}finally{globalThis.fetch=originalFetch;}});
test("unapproved record is rejected",async()=>{install([{...asset,approved_at:null}]);try{await throwsCode("NOT_APPROVED");}finally{globalThis.fetch=originalFetch;}});
test("unexpected media origin rejected before fetch",async()=>{install([{...asset,url:"https://other.example/evil.jpg"}]);try{await throwsCode("INVALID_SOURCE");}finally{globalThis.fetch=originalFetch;}});
