import {notFound} from 'next/navigation'
import {galleryFinancialReviewMode} from '@/lib/gallery/environment'
import FinancialReview from './FinancialReview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export default function FinancialReviewPage() {
  // No financial data in server HTML. API checks authority and actual origin.
  const mode=galleryFinancialReviewMode(process.env.NEXT_PUBLIC_SITE_URL ?? '')
  if(mode==='blocked') notFound()
  return <main className="max-w-6xl mx-auto px-4 pt-24 pb-16">
    <FinancialReview mode={mode} />
  </main>
}
