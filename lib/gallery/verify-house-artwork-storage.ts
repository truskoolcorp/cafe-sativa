import {createHash} from 'node:crypto'
import type {createAdminClient} from '@/lib/supabase/admin'

/** Read-only pre-payment gate. A storage.objects row is not proof of readable,
 * intact bytes or a private destination. Never return the master or its path. */
export async function verifyHouseArtworkStorage(
 db:ReturnType<typeof createAdminClient>,productId:string,
 asset:{object_path:string;sha256:string},expectedBytes?:number
):Promise<boolean>{
 try{
  if(!asset.object_path?.startsWith(productId+'/')||
     asset.object_path.includes('..')||!/^([a-f0-9]{64})$/.test(asset.sha256))return false
  const [approved,delivery]=await Promise.all([
   db.storage.getBucket('gallery-approved'),db.storage.getBucket('gallery-private')
  ])
  if(approved.error||delivery.error||approved.data?.id!=='gallery-approved'||approved.data.public!==false||
     delivery.data?.id!=='gallery-private'||delivery.data.public!==false)return false
  const source=await db.storage.from('gallery-approved').download(asset.object_path)
  if(source.error||!source.data||source.data.size<1||source.data.size>50*1024*1024||
     (expectedBytes!==undefined&&source.data.size!==expectedBytes))return false
  const bytes=Buffer.from(await source.data.arrayBuffer())
  return bytes.length===source.data.size&&createHash('sha256').update(bytes).digest('hex')===asset.sha256
 }catch{return false}
}
