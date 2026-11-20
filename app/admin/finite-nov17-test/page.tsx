import {isContentAdmin} from '@/lib/content/auth'
import {redirect} from 'next/navigation'
import FiniteTest from './FiniteTest'
export const dynamic='force-dynamic'
export default async function Page(){
 if(!await isContentAdmin())redirect('/auth/signin')
 const enabled=process.env.CS_CHARACTER_FINITE_NOV17_TEST_ENABLED==='true'&&Date.now()>=Date.parse('2026-11-17T06:00:00Z')&&Date.now()<Date.parse('2026-11-18T06:00:00Z')
 return <main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Private Zaria November 17 test</h1><p className="my-4">A separately authorized November 17, 2026 Dallas test only: one private script with an additional $0.10 Anthropic budget, then one Bree included-credit audio sample of at most 250 characters. No paid speech overage, video, publishing or recurring activation. The November 16 attempt stays frozen.</p><p className="my-4">Each click requests one next authorized phase, never an automatic retry. A saved script may be followed by one explicit audio request. A held or uncertain result must be reconciled before any further action. Reloading this page does not grant new authority.</p><FiniteTest enabled={enabled}/></main>
}
