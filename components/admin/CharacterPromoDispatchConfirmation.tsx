'use client'

import { promoDispatchTimeIssue } from '@/lib/content/character-promo-dispatch-time'
import { useEffect, useRef, useState } from 'react'
import type { PromoSnapshot } from '@/lib/content/character-promo-delivery'

export type CharacterPromoDispatchConfirmationProps = {
  snapshot: PromoSnapshot
  reviewedDigest: string
  enabled?: boolean
}
type Review = { snapshot: PromoSnapshot; reviewedDigest: string }
type Outcome = 'idle' | 'submitting' | 'scheduled' | 'reconciliation_required'
const SHA = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function scheduledReceiptMatches(value: unknown, review: Review): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  if (result.status !== 'scheduled' || result.publicationConfirmed !== false || !result.receipt || typeof result.receipt !== 'object') return false
  const receipt = result.receipt as Record<string, unknown>, s = review.snapshot
  return receipt.state === 'scheduled' && typeof receipt.providerId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt.providerId) &&
    typeof receipt.providerUuid === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt.providerUuid) &&
    receipt.snapshotDigest === review.reviewedDigest && receipt.videoSha256 === s.videoSha256 && receipt.network === s.network &&
    receipt.accountId === s.accountId && receipt.brandId === s.brandId && receipt.userId === s.userId &&
    receipt.caption === s.caption && receipt.scheduledAt === s.scheduledAt && receipt.timezone === s.timezone
}

/** Separate permission to transmit the exact private video and schedule one destination.
 * The server must revalidate the displayed digest and durable claim; this UI grants no gates.
 * A mounted panel makes at most one request, including after an uncertain outcome.
 */
export default function CharacterPromoDispatchConfirmation({ snapshot, reviewedDigest, enabled = false }: CharacterPromoDispatchConfirmationProps) {
  const [consentKey, setConsentKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<Review | null>(null)
  const [outcome, setOutcome] = useState<Outcome>('idle')
  const attempted = useRef(false), alive = useRef(true), consent = useRef<string | null>(null)
  const key = JSON.stringify([reviewedDigest, snapshot])
  const latest = useRef({ key, enabled })
  // Clear consent synchronously on any reviewed-field or rollout change. Returning to
  // earlier props must not resurrect a previous checkbox or a stale click handler.
  if (latest.current.key !== key || latest.current.enabled !== enabled) consent.current = null
  latest.current = { key, enabled }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const review = attempt || { snapshot, reviewedDigest }, s = review.snapshot
  const timeIssue=promoDispatchTimeIssue(snapshot.scheduledAt,snapshot.timezone)
  const wholeSecondTime=timeIssue!== 'precision'
  const valid = !timeIssue && UUID.test(snapshot.planId) && SHA.test(reviewedDigest) && SHA.test(snapshot.videoSha256) &&
    Number.isSafeInteger(snapshot.videoBytes) && snapshot.videoBytes >= 16 && snapshot.videoBytes <= 35 * 1024 * 1024 &&
    (snapshot.network === 'facebook' || snapshot.network === 'threads') && Boolean(snapshot.accountId) &&
    Boolean(snapshot.caption?.trim()) && Number.isFinite(Date.parse(snapshot.scheduledAt))
  const checked = consentKey === key && consent.current === key
  const locked = enabled !== true || !valid || attempted.current || outcome !== 'idle'
  let localTime = s.scheduledAt
  try { localTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: s.timezone }).format(new Date(s.scheduledAt)) } catch { /* Keep the exact source value visible. */ }

  async function submit() {
    if (!alive.current || attempted.current || latest.current.key !== key || latest.current.enabled !== true || !valid || !checked || consent.current !== key) return
    // Set before the first await and never release it, even for a rejected response.
    attempted.current = true
    consent.current = null
    const exact: Review = JSON.parse(JSON.stringify({ snapshot, reviewedDigest }))
    setAttempt(exact); setConsentKey(null); setOutcome('submitting')
    try {
      const response = await fetch('/api/admin/programming/character-promos/dispatch', {
        method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: exact.snapshot.planId, reviewedDigest: exact.reviewedDigest, explicitConfirmation: true, transmitApprovedVideo: true }),
      })
      const result: unknown = await response.json()
      if (alive.current) setOutcome(response.ok && scheduledReceiptMatches(result, exact) ? 'scheduled' : 'reconciliation_required')
    } catch {
      if (alive.current) setOutcome('reconciliation_required')
    }
  }

  return <section aria-label="Separate exact-video transmission and scheduling confirmation" className="space-y-4 rounded-xl border border-amber-500 p-5">
    <h2 className="text-xl font-semibold">Transmit this private MP4 and schedule one post</h2>
    <p>Previous content and delivery approvals do not trigger this action. This separate confirmation sends the exact private MP4 to Metricool for the single destination below.</p>
    <dl className="space-y-2">
      <div><dt className="font-semibold">Private MP4 SHA-256</dt><dd className="break-all font-mono text-xs">{s.videoSha256}</dd></div>
      <div><dt className="font-semibold">Exact verified size</dt><dd>{s.videoBytes} bytes</dd></div>
      <div><dt className="font-semibold">Destination</dt><dd>{s.network === 'facebook' ? 'Facebook' : s.network === 'threads' ? 'Threads' : 'Unverified network'} · Account {s.accountId} · Tru Skool brand {s.brandId}</dd></div>
      <div><dt className="font-semibold">Exact caption</dt><dd className="whitespace-pre-wrap">{s.caption}</dd></div>
      <div><dt className="font-semibold">Scheduled time</dt><dd><time dateTime={s.scheduledAt}>{localTime}</time> · {s.timezone}<br/>Exact UTC: {s.scheduledAt}</dd></div>
      <div><dt className="font-semibold">Reviewed delivery digest</dt><dd className="break-all font-mono text-xs">{review.reviewedDigest}</dd></div>
    </dl>
    <p>Metricool receives this private video for scheduling. A scheduled receipt is not proof of publication. No other account or destination is authorized.</p>
    <label className="flex items-start gap-2"><input type="checkbox" className="shrink-0" checked={checked && !attempted.current} disabled={locked} onChange={event => {
      if (locked || !alive.current || attempted.current || latest.current.key !== key || latest.current.enabled !== true) return
      consent.current = event.target.checked ? key : null
      setConsentKey(consent.current)
    }}/><span className="min-w-0 [overflow-wrap:anywhere]">I explicitly authorize transmission of this exact private MP4 (SHA-256 {s.videoSha256}, {s.videoBytes} bytes) to Metricool and scheduling it on {s.network === 'facebook' ? 'Facebook' : 'Threads'} account {s.accountId}, with exactly the caption and time displayed above. This does not confirm publication.</span></label>
    <button type="button" disabled={locked || !checked} onClick={() => void submit()} className="rounded border border-amber-400 px-4 py-2 disabled:opacity-50">Transmit this exact MP4 and schedule once</button>
    {outcome === 'idle' && enabled !== true && <p role="status">Scheduling is disabled pending approved rollout. Nothing will be transmitted.</p>}
    {outcome === 'idle' && timeIssue==='ambiguous' && <p role="status">This local time repeats during the daylight-saving change. Explicitly choose and approve a different unambiguous time; no UTC offset or fold will be silently selected.</p>}
    {outcome === 'idle' && !wholeSecondTime && <p role="status">The provider accepts whole-second times only. Explicitly reauthor and reapprove a whole-second UTC time; this approved time will not be rounded.</p>}
    {outcome === 'idle' && !valid && <p role="status">Exact reviewed delivery details are incomplete. Transmission is blocked.</p>}
    {outcome === 'submitting' && <p role="status">One scheduling request is in progress. Do not retry or resubmit it.</p>}
    {outcome === 'scheduled' && <p role="status">Scheduled. The exact scheduling receipt was verified. Publication is not confirmed. This request cannot be resubmitted here.</p>}
    {outcome === 'reconciliation_required' && <p role="alert">Scheduling is not confirmed. Do not retry, including after a reload. Manual reconciliation of the existing attempt is required before any further dispatch.</p>}
  </section>
}
