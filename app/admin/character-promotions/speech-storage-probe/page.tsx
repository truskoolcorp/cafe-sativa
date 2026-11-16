import {isContentAdmin} from '@/lib/content/auth'
import ProbeClient from './probe-client'
export const dynamic='force-dynamic'
export default async function SpeechStorageProbePage(){
 if(!await isContentAdmin())return <main className="p-8 pt-28"><h1>Administrator sign-in required</h1><p>Sign in with the existing Café content administrator account.</p></main>
 const attemptId=process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_ATTEMPT_ID??'',expiresAt=process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_EXPIRES_AT??''
 const enabled=process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_ENABLED==='true'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)&&Number.isFinite(Date.parse(expiresAt))&&Date.parse(expiresAt)>Date.now()
 return <main className="mx-auto max-w-3xl p-8 pt-28"><h1 className="text-2xl mb-4">Private speech storage probe</h1><p>API authorization, finite configuration and private-storage checks remain authoritative.</p><ProbeClient attemptId={attemptId} expiresAt={expiresAt} enabled={enabled}/></main>
}
