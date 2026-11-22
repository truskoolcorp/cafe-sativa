import { createHash } from "node:crypto";

/** Private character reference retrieval. Server-only: never expose service keys or signed bytes publicly. */
export const ZARIA_CHARACTER_ASSETS = Object.freeze({
 bucket: "cafe-sativa-characters",
 approved: ["front-facial-master.jpeg","full-body.jpeg","side-alt.jpeg","side-clean.jpeg","three-quarter.jpeg"].map(name=>"zaria-solenne/approved/"+name),
 candidate: "zaria-solenne/venue-references/gallery-candidate.png",
 manifest: "zaria-solenne/manifests/asset-manifest.json"
});
export interface PrivateStorageClient {
 storage: { from(bucket: string): { download(path: string): Promise<{data: Blob | null; error: {message:string} | null}> } };
}
export async function verifiedPrivateCharacterAsset(client:PrivateStorageClient,path:string,expectedSha256:string):Promise<Uint8Array> {
 const allowed = [...ZARIA_CHARACTER_ASSETS.approved,ZARIA_CHARACTER_ASSETS.candidate,ZARIA_CHARACTER_ASSETS.manifest];
 if (!allowed.includes(path)) throw new Error("UNREGISTERED_CHARACTER_ASSET");
 if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("INVALID_EXPECTED_DIGEST");
 const {data,error} = await client.storage.from(ZARIA_CHARACTER_ASSETS.bucket).download(path);
 if(error || !data) throw new Error("CHARACTER_ASSET_DOWNLOAD_FAILED");
 const bytes = new Uint8Array(await data.arrayBuffer());
 if(bytes.length===0 || bytes.length>10485760) throw new Error("CHARACTER_ASSET_SIZE_INVALID");
 const actual = createHash("sha256").update(bytes).digest("hex");
 if(actual !== expectedSha256) throw new Error("CHARACTER_ASSET_DIGEST_MISMATCH");
 return bytes;
}
