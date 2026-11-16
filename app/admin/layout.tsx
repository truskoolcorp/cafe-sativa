import { notFound } from 'next/navigation'
import { isContentAdmin } from '@/lib/content/auth'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!await isContentAdmin()) notFound()
  return <>{children}</>
}
