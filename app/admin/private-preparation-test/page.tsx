import {isContentAdmin} from '@/lib/content/auth'
import {redirect} from 'next/navigation'
import PrivateTest from './PrivateTest'
export const dynamic='force-dynamic'
export default async function Page(){
 if(!await isContentAdmin())redirect('/auth/signin')
 return <main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Private Zaria text and voice test</h1><p className="my-4">One original Gallery script, then one included-credit Bree recording. Each click runs at most one phase. No video, publishing or recurring activation. Existing clips are not replayed.</p><p className="my-4">This finite adapter expires at midnight Dallas on November 16, 2026. Its server-side budget and source approvals must already be configured.</p><PrivateTest /></main>
}
