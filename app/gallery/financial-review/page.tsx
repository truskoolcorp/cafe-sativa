import {notFound} from 'next/navigation'
import {galleryEnvironment} from '@/lib/gallery/environment'
import FinancialReview from './FinancialReview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export default function FinancialReviewPage() {
  // No financial data in server HTML. The authenticated, isolated API checks
  // the actual request origin and authority on every load.
  if(process.env.GALLERY_FINANCIAL_REVIEW_TEST !== 'true' ||
     galleryEnvironment(process.env.NEXT_PUBLIC_SITE_URL ?? '') !== 'isolated-test') notFound()
  return <main className="max-w-6xl mx-auto px-4 pt-24 pb-16">
    <FinancialReview />
  </main>
}
