import { notFound } from 'next/navigation'
import StageProgramCanary from '@/components/events/StageProgramCanary'
import { AHNIKA_STAGE_CANARY, canPreviewAhnikaStage } from '@/lib/events/ahnika-stage-preview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function generateMetadata() {
  return {
    title: canPreviewAhnikaStage(process.env) ? 'Private Ahnika Stage canary' : 'Café Sativa',
    robots: { index: false, follow: false },
  }
}

export default function AhnikaStagePreviewPage() {
  if (!canPreviewAhnikaStage(process.env)) notFound()
  return <StageProgramCanary program={AHNIKA_STAGE_CANARY} />
}
