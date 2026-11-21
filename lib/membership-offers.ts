export type MembershipCadence = 'monthly' | 'annual'

export const MEMBERSHIP_OFFER_CENTS = {
  regular: { monthly: 999, annual: 9990 },
  vip: { monthly: 2499, annual: 24990 },
} as const

export function annualMembershipEnabled() {
  return process.env.NEXT_PUBLIC_CAFE_ANNUAL_MEMBERSHIPS === 'true'
}
