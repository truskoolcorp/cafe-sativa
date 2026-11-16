import {isContentAdmin} from '@/lib/content/auth'
import {reviewedZariaSpeech} from '@/lib/content/character-production-zaria-speech-reviewed'
import SpeechClient from './speech-client'
export const dynamic='force-dynamic'
export default async function ZariaFiniteSpeechPage(){
 if(!await isContentAdmin())return <main className="p-8 pt-28"><h1>Administrator sign-in required</h1></main>
 const enabled=process.env.CS_CHARACTER_FINITE_SPEECH_ENABLED==='true'&&Date.now()<reviewedZariaSpeech.expiresAt
 return <main className="mx-auto max-w-3xl p-8 pt-28"><h1 className="text-2xl mb-4">Zaria: private Look Again audio</h1><p>{reviewedZariaSpeech.script}</p><p>Operation: {reviewedZariaSpeech.key}</p><p>Expires: {new Date(reviewedZariaSpeech.expiresAt).toISOString()}</p><p>Canonical voice, included credits only, no overage. Private audio remains unapproved for publication. No video, Gallery scene binding or social post is created.</p><p>Before invocation, confirm the read-only storage probe receipt and absence of this operation’s existing claim. If uncertain, reconcile; never retry.</p><section className="my-6"><h2>Private recording for listening review</h2><p>Playback verifies the existing receipt and audio. Listening does not approve publication or create another recording.</p><audio controls preload="none" src="/api/admin/character-promotions/zaria-look-again-speech/audio"/><p><a href="/api/admin/character-promotions/zaria-look-again-speech/audio" download="zaria-look-again-private.mp3">Download private MP3</a></p></section><SpeechClient enabled={enabled} expiresAt={reviewedZariaSpeech.expiresAt}/></main>
}
