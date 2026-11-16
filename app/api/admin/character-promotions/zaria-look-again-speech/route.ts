import {createFiniteIncludedSpeechHandler} from '@/lib/content/character-production-included-speech-server'
import {reviewedZariaSpeech} from '@/lib/content/character-production-zaria-speech-reviewed'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=90
/** No GET generation, request-controlled scope, scene binding or publication. */
export const POST=createFiniteIncludedSpeechHandler(reviewedZariaSpeech)
/** GET reads only this fixed operation's existing receipt and audio. */
export {readZariaSpeechReceipt as GET} from '@/lib/content/character-production-zaria-speech-receipt-server'
