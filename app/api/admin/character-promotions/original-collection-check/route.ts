import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {reviewedCanaryManifest} from '@/lib/content/character-production-canary-manifest'
import {createProductionFetch,createProductionProviderFetch} from '@/lib/content/character-production-bounded-fetch'
import {createPrivateOutputStorage} from '@/lib/content/character-production-broker-boundary'
import {createDirectHeyGenApi,directHeyGenCodecs} from '@/lib/content/character-production-heygen-direct'
import {createHeyGenProductionProvider} from '@/lib/content/character-production-provider-heygen'
import {createOriginalCollectionCheck,originalCheck,safeStatusShape} from '@/lib/content/character-production-original-check'
export const dynamic='force-dynamic'
export const maxDuration=60
export const GET=createOriginalCollectionCheck({authorize:isContentAdmin,open(signal,progress){
 const network=createProductionFetch(signal),providerNetwork=createProductionProviderFetch(signal,fetch,8000)
 const db=createAdminClient(network.fetch),storage=createPrivateOutputStorage(db.storage,15000)
 const api=createDirectHeyGenApi(()=>process.env.HEYGEN_API_KEY,providerNetwork.fetch,1000,8000)
 const config={...reviewedCanaryManifest().configuration.heygen,phases:{prepareMs:1000,submitMs:1000,statusMs:8000,downloadMs:20000,totalMs:28000}}
 const provider=createHeyGenProductionProvider(config,{
  create_video_from_avatar:async()=>{throw Error('Creation forbidden in read-only check')},
  get_video:async(args,inner)=>{if(args.videoId!==originalCheck.task)throw Error('Original task only');progress('status');const raw=await api.video(args.videoId,inner);progress('download',safeStatusShape(raw));return raw},
 },directHeyGenCodecs)
 return {collect:provider.collect,privateBucket:storage.privateBucket,read:storage.read,async whenSettled(){await Promise.all([network.whenSettled(),providerNetwork.whenSettled()])}}
}})
