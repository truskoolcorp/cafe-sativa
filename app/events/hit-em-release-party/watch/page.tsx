import { redirect } from 'next/navigation'
import { HIT_EM_PREMIERE } from '@/lib/events/hit-em-premiere'

export const dynamic = 'force-dynamic'

// Existing account/watch links lead to the same public party, not the generic
// ticketed Zoom page. The destination independently checks publication state.
export default function HitEmWatchPage() {
  redirect(HIT_EM_PREMIERE.path)
}
