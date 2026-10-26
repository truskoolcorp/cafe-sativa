/** Pure fail-closed approval predicate for Zaria private renders. */
export function requireZariaRenderApproval(input:{galleryApproved:boolean;voiceApproved:boolean;ownerAuthorized:boolean}):void{
 if(input.galleryApproved !== true || input.voiceApproved !== true || input.ownerAuthorized !== true) throw new Error("ZARIA_RENDER_NOT_APPROVED");
}
