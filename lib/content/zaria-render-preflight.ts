import { createClient } from "@/lib/supabase/server";
import { verifiedPrivateCharacterAsset, ZARIA_CHARACTER_ASSETS } from "@/lib/private-character-assets";

/** A fail-closed check for private Zaria media generation.
 * This verifies bytes, not likeness, venue composition, voice or publication consent.
 * Never use a boolean supplied by the browser as a substitute for this server-side call.
 */
const required: ReadonlyArray<readonly [string,string]> = [
 ["zaria-solenne/approved/front-facial-master.jpeg","47b8fe1775ecafd05961cffffa317db0c17aee0da068dfa9cd414f85dc39f25d"],
 ["zaria-solenne/approved/three-quarter.jpeg","264bfbf3783c78b802adf8ec9e827b9badc14f0ac288fe2ab4314ef72340e30d"],
 ["zaria-solenne/approved/full-body.jpeg","ec07d605f327ae9066837e4faa69c36d1ff080a21a66e59af03e732933e8bad2"],
 ["zaria-solenne/approved/side-alt.jpeg","67d01f197438d26473e0228998f03f7480f8493e03c7e30773e368fdc3fed5e9"],
 ["zaria-solenne/approved/side-clean.jpeg","c219dabe2822d0a6a756d197c7da9aead285931598b65717f3f62502f2588a5a"],
 ["zaria-solenne/venue-references/gallery-candidate.png","c48c1e9869b6736da21ee2a45e5ea710a8d44afa4620d3af1188f8af89ddde82"],
 ["zaria-solenne/manifests/asset-manifest.json","6cbb8e41046d88a2edbb42511107df514e4d322e82344a649a135fb821b8eb34"]
];
export async function requireZariaAssetPreflight():Promise<void>{
 const db=createClient();
 for(const [path,sha] of required) await verifiedPrivateCharacterAsset(db,path,sha);
}
/** Separate human approval state is mandatory even after integrity checks pass. */
export function requireZariaRenderApproval(input:{galleryApproved:boolean;voiceApproved:boolean;ownerAuthorized:boolean}):void{
 if(!input.galleryApproved || !input.voiceApproved || !input.ownerAuthorized)throw new Error("ZARIA_RENDER_NOT_APPROVED");
}
