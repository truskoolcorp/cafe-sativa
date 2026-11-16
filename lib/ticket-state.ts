export function ticketingClosedReason(event: {status:string; starts_at:string; capacity:number|null}, now=Date.now()):string|null {
  if(!['scheduled','live'].includes(event.status))return 'This event is not open for ticketing.'
  const starts=Date.parse(event.starts_at)
  if(!Number.isFinite(starts) || starts<=now)return 'Ticket sales for this event are closed.'
  return null
}
