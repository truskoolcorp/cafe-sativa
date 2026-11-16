import {isContentAdmin} from '@/lib/content/auth'
import {redirect} from 'next/navigation'
import Recovery from './Recovery'
export const dynamic='force-dynamic'
export default async function Page(){
 if(!await isContentAdmin())redirect('/auth/signin')
 return <main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Private Zaria text recovery</h1><p className="my-4">One separately authorized recovery of the pre-provider failure. The original occurrence stays immutable. Uses the same daily text key and $0.10 total budget, with no video, speech, publishing or recurring activation here. Expires at midnight Dallas on November 16, 2026.</p><Recovery /></main>
}
