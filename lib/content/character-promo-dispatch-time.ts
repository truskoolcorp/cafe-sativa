/** Metricool's verified local-date contract has whole seconds and no UTC offset.
 * Block nearby repeated wall times rather than silently choose a DST fold. The
 * bounded offset comparison covers the verified America/Chicago mapping. */
export function promoDispatchTimeIssue(iso:string,timezone:string):'precision'|'ambiguous'|'invalid'|null {
 const timestamp=Date.parse(iso)
 if(!Number.isFinite(timestamp))return 'invalid'
 if(timestamp%1000!==0||new Date(timestamp).toISOString()!==iso)return 'precision'
 try {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  const wall=(t:number)=>formatter.formatToParts(new Date(t)).map(p=>p.type+':'+p.value).join('|')
  const original=wall(timestamp)
  for(const minutes of [-120,-90,-60,-30,30,60,90,120])if(wall(timestamp+minutes*60000)===original)return 'ambiguous'
  return null
 }catch{return 'invalid'}
}
