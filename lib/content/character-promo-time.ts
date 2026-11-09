/** PostgreSQL timestamptz CAS tokens retain microseconds. JS Date is used only for
 * whole-second timezone conversion, never to round the fractional token. */
export function normalizePromoDatabaseTime(value:unknown,millisecondOnly=false):string|null {
 if(typeof value!=='string')return null
 const m=value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})$/)
 if(!m)return null
 const fraction=(m[3]||'').padEnd(6,'0')
 if(millisecondOnly&&fraction.slice(3)!=='000')return null
 const timezone=m[4]==='Z'?'Z':m[4].replace(/^([+-]\d{2})(\d{2})$/,'$1:$2')
 const seconds=Date.parse(`${m[1]}T${m[2]}${timezone}`)
 if(!Number.isFinite(seconds))return null
 let precise=fraction
 while(precise.length>3&&precise.endsWith('0'))precise=precise.slice(0,-1)
 return new Date(seconds).toISOString().slice(0,19)+'.'+precise+'Z'
}
