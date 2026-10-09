import { createAdminClient } from '@/lib/supabase/admin'

export const SITE_CATEGORIES = ['stage','kitchen','cigar_lounge','bar','gallery','community'] as const
export const SITE_BRIEFS = [
  { category:'stage', title:'The Stage: voices, verses and an open floor', agent:'ahnika', copy:'The Stage brings Café Sativa’s music and spoken-word intentions into the virtual venue. Ahnika Merlot’s open-mic format gives each participant three minutes for verse, spoken word or song, with every membership tier welcome. Comedy Night Open Floor is hosted by Laviche, with rotating stand-up and improv and performer sign-up.\n\nThese are established programming formats, not confirmed upcoming performances. Session dates, participation links and recordings will appear here when ready.' },
  { category:'kitchen', title:'The Kitchen: featured chefs and Café Sativa After Dark', agent:'commander', copy:'Fusion cuisines are one of Café Sativa’s core creative directions. The Kitchen’s intended rhythm includes one or two rotating visiting or featured chefs each month. Earlier planning included Sourdough Fundamentals with Andromeda Zouganelis; the historical June date is not a current booking.\n\nCafé Sativa After Dark includes the virtual-first MUKBANG After Dark flagship, with The Table Talk, First Bite, ASMR Bang, Rate My Plate, creator challenges and audience voting. Episodes and participation details will be listed when ready. No chef appearance or live session is confirmed by this introduction.' },
  { category:'cigar_lounge', title:'The Cigar Lounge: conversation, craft and guided formats', agent:'laviche', copy:'Laviche’s established Cigar Lounge formats include a Cuban-versus-Dominican blind tasting with a community vote, a guided cigar-and-whiskey pairing, and a VIP Craft Roundtable exploring rolling, blending and regional styles.\n\nThis introduction describes the programming vision. Earlier June and July planning dates are historical; they are not current invitations or reservations. Confirmed virtual sessions, access details and approved episode media will appear here when available.' },
  { category:'bar', title:'The Bar: explore the future venue vision', agent:'commander', copy:'Explore the approved virtual Café Sativa bar preview: warm light, thoughtful details and room for a good conversation. This concept preview introduces the vision for our future venue.\n\nThe physical venue is planned for 2027, with the exact opening date still to be confirmed. This page does not announce operating hours, a purchasable menu or a booked bar event. Approved features and confirmed programming will appear here as they are ready.' },
  { category:'gallery', title:'Gallery: art within the Café Sativa vision', agent:'commander', copy:'Art is one of Café Sativa’s core creative directions. The Gallery belongs alongside music, community and fusion cuisines in the virtual venue. THE Verse Alkemist is Café Sativa’s official Media Curator.\n\nArtist features, exhibition details and works will be added with their actual references and permissions. This introduction does not announce a booked exhibition or offer an unverified artwork for sale.' },
  { category:'community', title:'At the Table: the Café Sativa conversation', agent:'laviche', copy:'At the Table is a 90-minute long-table conversation hosted by founder Keith Ingram with Laviche. Its purpose is to share the Café Sativa story, the “Sip. Smoke. Vibe.” vision and the community taking shape before the physical Tenerife doors open.\n\nThe long table is central to this format. This introduction is not a currently scheduled gathering; the earlier planning date does not establish a new session. Confirmed dates and participation details will appear here when ready. The physical venue is planned for 2027, with its opening date still to be confirmed.' },
] as const

export async function planSiteContent(now = new Date()) {
  const db = createAdminClient()
  const existing = await db.from('content_items').select('site_category,status,created_at').not('site_category','is',null)
  if (existing.error) throw existing.error
  let planned = 0
  for (const brief of SITE_BRIEFS) {
    // One initial evergreen feature per category. Do not manufacture repeat content.
    if (existing.data?.some(row => row.site_category === brief.category)) continue
    const result = await db.from('content_items').insert({ site_key:`site-program-v1:${brief.category}`, site_category:brief.category, title:brief.title, copy_draft:brief.copy, channel:'lounge_announcement', agent:brief.agent, status:'pending_approval', approval_notes:'Program introduction recovered from prior owner instructions; see docs/SITE_PROGRAMMING.md. Historical dates are not bookings. Editorial agent assignment does not attach a canonical character image or voice. Review and approve from the dashboard before publication.', scheduled_at:now.toISOString() })
    if (result.error && result.error.code !== '23505') throw result.error
    if (!result.error) planned++
  }
  return planned
}

export async function publishDueSiteContent(now = new Date()) {
  const db = createAdminClient()
  const due = await db.from('content_items').select('*').not('site_category','is',null).in('status',['approved','scheduled']).not('approved_at','is',null).not('approved_by','is',null).lte('scheduled_at',now.toISOString())
  if (due.error) throw due.error
  let published = 0
  for (const item of due.data || []) {
    // Text-only editorial content is supported; linked media needs its own approved job.
    if (item.media_url) continue
    if (!item.copy_final?.trim()) continue
    const result = await db.from('content_items').update({status:'published',published_at:now.toISOString(),publish_error:null,updated_at:now.toISOString()}).eq('id',item.id).in('status',['approved','scheduled']).eq('updated_at',item.updated_at).select('id')
    if (result.error) throw result.error
    published += result.data?.length || 0
  }
  return published
}

export async function getSiteContent(category?:string) {
  const db = createAdminClient()
  let query = db.from('content_items').select('id,title,copy_final,site_category,published_at').eq('status','published').not('approved_at','is',null).not('approved_by','is',null).not('site_category','is',null).lte('published_at',new Date().toISOString()).order('published_at',{ascending:false}).limit(30)
  if (category) query=query.eq('site_category',category)
  const result=await query
  if (result.error) throw new Error('Website features are temporarily unavailable')
  return result.data || []
}
