/** Fixed existing route, not standing permission to send future items. Client-safe. */
export const SOCIAL_DESTINATION = Object.freeze({
  version: 'truskool-facebook-threads-v1',
  provider: 'metricool',
  brandId: 5373515,
  userId: 4174093,
  facebookPageId: '146219355471397',
  threadsHandle: 'truskoolcorp',
} as const)
export type SocialDestination = typeof SOCIAL_DESTINATION

/** Require the entire displayed destination, including its version. No additions. */
export function isSocialDestination(value: unknown): value is SocialDestination {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === Object.keys(SOCIAL_DESTINATION).length &&
    Object.entries(SOCIAL_DESTINATION).every(([key, expected]) =>
      Object.prototype.hasOwnProperty.call(candidate, key) && candidate[key] === expected)
}
