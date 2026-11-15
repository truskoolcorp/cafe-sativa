/** Strict frame-count measurement for requested mp3_44100_128. Unsupported audio
 * holds for offline inspection; never estimate duration from Content-Length. */
export function measureIncludedMp3Duration(bytes:Uint8Array):number{
 let offset=0,frames=0
 if(bytes.length>=10&&Buffer.from(bytes.subarray(0,3)).toString('ascii')==='ID3'){
  if(bytes[3]!==3&&bytes[3]!==4||[6,7,8,9].some(i=>bytes[i]>=128))throw Error('unsupported_id3')
  const size=(bytes[6]<<21)+(bytes[7]<<14)+(bytes[8]<<7)+bytes[9]
  offset=10+size+(bytes[3]===4&&(bytes[5]&16)?10:0)
  if(offset>bytes.length)throw Error('truncated_id3')
 }
 while(offset<bytes.length){
  if(bytes.length-offset===128&&Buffer.from(bytes.subarray(offset,offset+3)).toString('ascii')==='TAG'){offset+=128;break}
  if(offset+4>bytes.length)throw Error('truncated_frame')
  const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2]
  // sync; MPEG1 LayerIII; 128kbps; 44.1kHz. Free-format/VBR unsupported.
  if(a!==255||(b&254)!==250||(c>>4)!==9||((c>>2)&3)!==0)throw Error('unsupported_frame')
  const size=Math.floor(144000*128/44100)+((c>>1)&1)
  if(offset+size>bytes.length)throw Error('truncated_frame')
  offset+=size;frames++
 }
 if(frames<1||offset!==bytes.length)throw Error('audio_unmeasurable')
 return frames*1152/44100
}
