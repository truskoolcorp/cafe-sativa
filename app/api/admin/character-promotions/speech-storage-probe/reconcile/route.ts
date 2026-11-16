import {runAuthorizedSpeechStorageReconciliation} from '@/lib/content/character-production-speech-storage-probe-server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
/** Fixed configured attempt readback only; no query/body-selected object. */
export const GET=runAuthorizedSpeechStorageReconciliation
