import { reviewedVenueBytes, inspectVenueBytes } from '@/lib/content/venue-watermark'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { MEDIA_UUID } from '@/lib/content/approved-media'
import { preserveFrameFilter, VideoFormat } from '@/lib/content/video-formats'

const execute = promisify(execFile)
const MAX_BYTES = 50 * 1024 * 1024
const VERSION = 'preserve-frame-v1'

export async function prepareVideoVariant(db: ReturnType<typeof createAdminClient>, job: { id: string; output_url: string }, format: VideoFormat) {
  // Reviewed reuse can reference another job's private canonical master.
  // Callers still enforce QA and canonical approval; accept only a flat UUID MP4.
  if (!MEDIA_UUID.test(job.id) || typeof job.output_url !== 'string' || !job.output_url.endsWith('.mp4') || !MEDIA_UUID.test(job.output_url.slice(0,-4))) throw new Error('Stored approved master required')
  const bucket = db.storage.from('cafe-sativa-content')
  const {bytes,sha256:hash}=await reviewedVenueBytes(db,job)
  let path=''
  {
    const folder = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const input = join(folder, 'master.mp4'), output = join(folder, 'export.mp4')
      await writeFile(input, bytes)
      const executable = join(process.cwd(), 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg')
      await execute(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', preserveFrameFilter(format), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-threads', '2', '-y', output], { timeout: 25000, maxBuffer: 512 * 1024 })
      const encoded = await readFile(output)
      if (!encoded.length || encoded.length > MAX_BYTES) throw new Error('Export size unsupported')
      const encodedHash=createHash('sha256').update(encoded).digest('hex')
      path=`variants/${job.id}/${hash}-${format}-${VERSION}/${encodedHash}.mp4`
      const saved = await bucket.upload(path, encoded, { contentType: 'video/mp4', upsert: false })
      if(saved.error){
        if(!explicitVariantConflict(saved.error))throw new Error('Export could not be stored')
        const existing=await inspectVenueBytes(db,{id:job.id,output_url:path})
        if(existing.sha256!==encodedHash || existing.bytes.length!==encoded.length)throw new Error('Existing derivative mismatch')
      }
    } finally { await rm(folder, { recursive: true, force: true }) }
  }
  // A transform/cache is not an independently reviewed public artifact.
  await reviewedVenueBytes(db,{id:job.id,output_url:path})
  const signed = await bucket.createSignedUrl(path, 60)
  if (signed.error || !signed.data) throw new Error('Export URL unavailable')
  return { url: signed.data.signedUrl, format, sourceSha256: hash, version: VERSION }
}

export function explicitVariantConflict(error:any){return String(error?.statusCode??error?.status)==='409' && (['ResourceAlreadyExists','KeyAlreadyExists','Duplicate'].includes(error?.error??error?.code)||error?.message==='The resource already exists')}
