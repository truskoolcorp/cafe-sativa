import { loadZariaGallery, zariaGalleryGroundRules } from './zaria-catalog'
export async function zariaGrounding(selection: unknown) {
 const gallery=await loadZariaGallery(selection)
 return {...gallery,liveProgramming:zariaGalleryGroundRules+'\nGallery catalogue: '+gallery.context}
}
