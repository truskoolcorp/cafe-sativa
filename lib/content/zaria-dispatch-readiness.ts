/** Server-owned Zaria video dispatch readiness. No provider call occurs here. */
export type ZariaDraftState = {
 status: string;
 voice_approved_at: string | null;
 video_qa_approved_at: string | null;
 publication_approved_at: string | null;
 evidence?: {private_character_storage?: {
   object_presence_verified?: boolean;
   byte_hashes_verified?: boolean;
   candidate_gallery_approved?: boolean;
   private_render_authorized?: boolean;
 }} | null;
};
export function zariaPrivateRenderBlockers(draft: ZariaDraftState | null, liveAssetHashesValid: boolean):string[] {
 if (!draft) return ["DRAFT_MISSING"];
 const storage=draft.evidence?.private_character_storage;
 const blockers:string[]=[];
 if(draft.status !== "draft") blockers.push("UNEXPECTED_DRAFT_STATE");
 if(storage?.object_presence_verified !== true) blockers.push("STORAGE_OBJECTS_UNVERIFIED");
 if(liveAssetHashesValid !== true) blockers.push("LIVE_ASSET_HASHES_UNVERIFIED");
 if(storage?.candidate_gallery_approved !== true) blockers.push("GALLERY_CANDIDATE_UNAPPROVED");
 if(!draft.voice_approved_at) blockers.push("VOICE_UNAPPROVED");
 if(storage?.private_render_authorized !== true) blockers.push("PRIVATE_RENDER_UNAUTHORIZED");
 return blockers;
}
export function zariaPublicationBlockers(draft:ZariaDraftState | null):string[] {
 if(!draft) return ["DRAFT_MISSING"];
 return [
  ...(!draft.video_qa_approved_at?["VIDEO_QA_UNAPPROVED"]:[]),
  ...(!draft.publication_approved_at?["PUBLICATION_UNAPPROVED"]:[])
 ];
}
