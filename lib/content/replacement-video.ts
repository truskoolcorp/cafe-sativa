import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPLACEMENT_MAX_BYTES = 3 * 1024 * 1024
export async function boundedVideoBody(req: Request) {
  if (req.headers.get('content-type') !== 'video/mp4' || Number(req.headers.get('content-length')) > REPLACEMENT_MAX_BYTES) throw new Error('Unsupported upload')
  const reader = req.body?.getReader()
  if (!reader) throw new Error('Missing upload')
  const chunks: Uint8Array[] = []; let total = 0
  let timedOut=false
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{})},10000)
  try {
    while (true) {
      const {done,value} = await reader.read()
      if (timedOut) throw new Error('Upload timed out')
      if (done) break
      total += value.byteLength
      if (total > REPLACEMENT_MAX_BYTES) { await reader.cancel(); throw new Error('Upload too large') }
      chunks.push(value)
    }
  } finally { clearTimeout(timer);reader.releaseLock() }
  const bytes=Buffer.concat(chunks)
  if(bytes.length<24 || bytes.toString('ascii',4,8)!=='ftyp')throw new Error('MP4 required')
  return bytes
}

export async function normalizeReplacementVideo(bytes: Buffer) {
  const folder=await mkdtemp(join(tmpdir(),'cs-replacement-'))
  try {
    const input=join(folder,'input.mp4'),output=join(folder,'preview.mp4')
    await writeFile(input,bytes)
    // Fixed local input, no network protocols, no audio/metadata, bounded output and runtime.
    await promisify(execFile)(join(process.cwd(),'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),[
      '-nostdin','-hide_banner','-loglevel','error','-xerror','-max_alloc','67108864','-filter_threads','1','-threads','2','-max_pixels','2073600','-protocol_whitelist','file,pipe','-f','mov','-i',input,
      '-map','0:v:0','-an','-sn','-dn','-map_metadata','-1','-t','5',
      '-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x101010,setsar=1',
      '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r','24','-threads','2','-fs',String(REPLACEMENT_MAX_BYTES),'-movflags','+faststart','-y',output
    ],{timeout:25000,maxBuffer:128*1024})
    const encoded=await readFile(output)
    if(encoded.length<24 || encoded.length>=REPLACEMENT_MAX_BYTES)throw new Error('Invalid encoded preview')
    return {bytes:encoded,sourceSha256:createHash('sha256').update(bytes).digest('hex'),storedSha256:createHash('sha256').update(encoded).digest('hex')}
  } finally {await rm(folder,{recursive:true,force:true})}
}
