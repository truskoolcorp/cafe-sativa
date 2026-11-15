import type {InternalProductionManifest} from './character-production-server-composition.ts'
/** Snapshot reviewed data at factory creation; preserve only the explicit clock
 * function. Later caller mutations cannot retarget images, voices or providers. */
export function snapshotProductionManifest(manifest:InternalProductionManifest):InternalProductionManifest {
 const {now,...engine}=manifest.configuration.engine
 return {
  expectedHeyGenUsername:manifest.expectedHeyGenUsername,
  images:structuredClone(manifest.images),
  ...(manifest.exactScope?{exactScope:structuredClone(manifest.exactScope)}:{}),
  configuration:{engine:{...structuredClone(engine),now},heygen:structuredClone(manifest.configuration.heygen)},
 }
}
