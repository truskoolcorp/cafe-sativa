import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MASTER_VIDEO, preserveFrameFilter } from '@/lib/content/video-formats'

const execute = promisify(execFile)
// Prepare only locally verified canonical bytes. Fit the complete composition;
// never crop, stretch, generate scenery or fetch a remote media source.
export async function prepareVenueFrame(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > 10_000_000) throw new Error('Reference size unsupported')
  const folder = await mkdtemp(join(tmpdir(), 'cs-keyframe-'))
  try {
    const input = join(folder, 'reference'), output = join(folder, 'landscape.png')
    await writeFile(input, bytes)
    await execute(join(process.cwd(), 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'), [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
      '-i', input, '-map', '0:v:0', '-frames:v', '1',
      '-vf', preserveFrameFilter('landscape'), '-c:v', 'png', '-threads', '1', '-y', output,
    ], { timeout: 10000, maxBuffer: 512 * 1024 })
    const image = await readFile(output)
    if (image.length < 24 || image.length > 10_000_000 ||
        image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        image.readUInt32BE(16) !== MASTER_VIDEO.width || image.readUInt32BE(20) !== MASTER_VIDEO.height) {
      throw new Error('Landscape keyframe could not be verified')
    }
    return image
  } finally { await rm(folder, { recursive: true, force: true }) }
}
