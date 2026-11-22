import {renderStageLavicheSpeech,verifyStageLavicheSpeech} from '@/lib/content/character-production-stage-laviche-server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=90
export const GET=verifyStageLavicheSpeech
export const POST=renderStageLavicheSpeech
