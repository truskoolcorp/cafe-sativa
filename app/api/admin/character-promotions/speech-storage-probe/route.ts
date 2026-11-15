import {runAuthorizedSpeechStorageProbe} from '@/lib/content/character-production-speech-storage-probe-server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
/** GET: sanitized live canon only. POST: harmless private Storage marker only.
 * No speech provider, synthesis endpoint, enrollment or permission mutation. */
export const GET=runAuthorizedSpeechStorageProbe
export const POST=runAuthorizedSpeechStorageProbe
