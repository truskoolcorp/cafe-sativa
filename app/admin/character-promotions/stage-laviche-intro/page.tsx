import {isContentAdmin} from '@/lib/content/auth'
import {stageLavicheSpeech} from '@/lib/content/character-production-stage-laviche-policy'
import StageLavicheSpeechClient from './speech-client'
export const dynamic='force-dynamic'

export default async function StageLavicheSpeechPage(){
 if(!await isContentAdmin())return <main className="p-8 pt-28"><h1>Administrator sign-in required</h1></main>
 return <main className="mx-auto max-w-3xl space-y-4 p-8 pt-28">
  <h1 className="text-2xl">Laviche: private Stage welcome</h1>
  <p>{stageLavicheSpeech.script}</p>
  <p>One take using included credits only. If a request is unconfirmed, do not retry. Review pronunciation and timing before lip-sync; this page cannot publish or change the show.</p>
  <StageLavicheSpeechClient expiresAt={stageLavicheSpeech.expiresAt}/>
  <section className="space-y-2">
   <h2>Verified private take</h2>
   <audio controls preload="none" src="/api/admin/character-promotions/stage-laviche-intro/audio"/>
   <p><a href="/api/admin/character-promotions/stage-laviche-intro/audio" download="stage-laviche-intro-private.mp3">Download private MP3</a></p>
  </section>
 </main>
}
