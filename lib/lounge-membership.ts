type Membership = { tier?: string; status?: string; current_period_end?: string | null } | null | undefined;
export function loungeMembershipTier(member: Membership, now = Date.now()): 'explorer' | 'regular' | 'vip' {
  if (!member || member.status !== 'active' || !['regular', 'vip'].includes(member.tier ?? '')) return 'explorer';
  const end = member.current_period_end ? Date.parse(member.current_period_end) : NaN;
  return Number.isFinite(end) && end > now ? member.tier as 'regular' | 'vip' : 'explorer';
}
