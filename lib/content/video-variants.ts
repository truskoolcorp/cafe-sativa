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
  if (!MEDIA_UUID.test(job.id) || job.output_url !== `${job.id}.mp4`) throw new Error('Stored approved master required')
  const bucket = db.storage.from('cafe-sativa-content')
  const master = await bucket.download(job.output_url)
  if (master.error || !master.data || master.data.size > MAX_BYTES) throw new Error('Master unavailable or too large for automatic export')
  const bytes = Buffer.from(await master.data.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')
  const path = `variants/${job.id}/${hash}-${format}-${VERSION}.mp4`
  const cached = await bucket.download(path)
  if (cached.error || !cached.data) {
    const folder = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const input = join(folder, 'master.mp4'), output = join(folder, 'export.mp4')
      await writeFile(input, bytes)
      const executable = join(process.cwd(), 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg')
      await execute(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', preserveFrameFilter(format), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-threads', '2', '-y', output], { timeout: 25000, maxBuffer: 512 * 1024 })
      const encoded = await readFile(output)
      if (!encoded.length || encoded.length > MAX_BYTES) throw new Error('Export size unsupported')
      const saved = await bucket.upload(path, encoded, { contentType: 'video/mp4', upsert: true })
      if (saved.error) throw new Error('Export could not be stored')
    } finally { await rm(folder, { recursive: true, force: true }) }
  }
  const signed = await bucket.createSignedUrl(path, 3600)
  if (signed.error || !signed.data) throw new Error('Export URL unavailable')
  return { url: signed.data.signedUrl, format, sourceSha256: hash, version: VERSION }
}
