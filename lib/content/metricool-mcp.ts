import { METRICOOL_MCP } from '@/lib/content/metricool-oauth'
// This connection proof performs reads only. Dispatch remains disabled.
export async function metricoolSession(token:string) {
  let session:string|null=null
  const deadline=Date.now()+25000
  async function rpc(id:number|null,method:string,params:unknown) {
    const headers:Record<string,string>={'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'}
    if(session)headers['Mcp-Session-Id']=session
    const response=await fetch(METRICOOL_MCP,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))})
    if(!response.ok)throw new Error('Metricool MCP connection failed')
    session=response.headers.get('mcp-session-id') || session
    if(id===null){await response.body?.cancel();return null}
    const reader=response.body?.getReader()
    if(!reader)throw new Error('Missing MCP response')
    const decoder=new TextDecoder();let text=''
    try {
      while(true) {
        const chunk=await reader.read()
        text+=decoder.decode(chunk.value || new Uint8Array(),{stream:!chunk.done})
        if(text.length>1000000)throw new Error('MCP response too large')
        const candidates=response.headers.get('content-type')?.includes('text/event-stream')?text.split(/\r?\n\r?\n/).slice(0,-1).map(event=>event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')):[text]
        for(const candidate of candidates) {
          let message;try{message=JSON.parse(candidate)}catch{continue}
          if(message.id!==id)continue
          if(message.error)throw new Error('Metricool MCP operation failed')
          return message.result
        }
        if(chunk.done)throw new Error('Incomplete MCP response')
      }
    }finally{await reader.cancel().catch(()=>{})}
  }
  await rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Cafe Sativa content operator',version:'1.0.0'}})
  await rpc(null,'notifications/initialized',{})
  const list=await rpc(2,'tools/list',{}),tools=list?.tools || []
  let nextId=3
  return {
    tools,
    async call(name:'getBrandSettings'|'getScheduledPosts'|'createScheduledPost',args:object) {
      const tool=tools.find((tool:{name:string})=>tool.name.replace(/_/g,'').toLowerCase()===name.toLowerCase())
      if(!tool)throw new Error('Required Metricool tool unavailable')
      const result=await rpc(nextId++,'tools/call',{name:tool.name,arguments:args})
      if(result?.isError)throw new Error('Metricool operation failed')
      let data=result?.structuredContent
      if(!data)for(const block of result?.content || [])if(block.type==='text'){try{data=JSON.parse(block.text);break}catch{}}
      if(!data)throw new Error('Invalid Metricool result')
      return data
    }
  }
}
export function verifiedMetricoolBrand(data:any) {
  const rows=Array.isArray(data)?data:data?.data
  const brand=rows?.find((row:{id:number;userId:number})=>Number(row.id)===5373515 && Number(row.userId)===4174093)
  if(!brand || brand.networksData?.facebookData!=='146219355471397' || brand.networksData?.threadsData!=='truskoolcorp')throw new Error('Expected Tru Skool Facebook and Threads accounts were not verified')
  const timezone=brand.timezone
  if(typeof timezone!=='string')throw new Error('Metricool timezone unavailable')
  new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(new Date())
  return {brandId:5373515,userId:4174093,label:brand.label || 'Tru Skool',timezone,networks:['facebook','threads']}
}
export async function verifyMetricoolConnection(token:string) {
  const session=await metricoolSession(token)
  return verifiedMetricoolBrand(await session.call('getBrandSettings',{}))
}
