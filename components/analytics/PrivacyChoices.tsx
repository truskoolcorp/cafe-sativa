'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  hasGlobalPrivacyControl, privacyConsent, startConsentSync,
  type PrivacyChoices as Choices,
} from '@/lib/analytics/privacy-consent'

export const OPEN_PRIVACY_CHOICES = 'cafe:open-privacy-choices'

export function PrivacyChoicesButton() {
  return <button id="cafe-privacy-choices-button" type="button" className="text-xs text-muted-foreground/70 hover:text-foreground underline underline-offset-2"
    onClick={() => window.dispatchEvent(new Event(OPEN_PRIVACY_CHOICES))}>
    Privacy choices
  </button>
}

export function PrivacyChoices() {
  const consent = useSyncExternalStore(privacyConsent.subscribe,
    privacyConsent.getSnapshot, privacyConsent.getServerSnapshot)
  const [hydrated, setHydrated] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Choices>({ analytics: false, marketing: false })
  const [message, setMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const stop = startConsentSync()
    setHydrated(true)
    const show = () => {
      opener.current = document.activeElement as HTMLElement
      const current = privacyConsent.getSnapshot()
      setDraft({ analytics: current.analytics, marketing: current.marketing })
      setOpen(true)
    }
    window.addEventListener(OPEN_PRIVACY_CHOICES, show)
    return () => { stop(); window.removeEventListener(OPEN_PRIVACY_CHOICES, show) }
  }, [])

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else {
      dialog.current?.close()
      if (opener.current?.isConnected) opener.current.focus()
      else if (opener.current) document.getElementById('cafe-privacy-choices-button')?.focus()
    }
  }, [open])

  function close() {
    setOpen(false)
  }
  function choose(choices: Choices) {
    const saved = privacyConsent.choose(choices)
    setMessage(saved ? 'Your privacy choices have been saved.' :
      'Your choice applies in this tab. Your browser could not save it for future visits.')
    close()
  }
  function manage() {
    opener.current = document.activeElement as HTMLElement
    setDraft({ analytics: consent.analytics, marketing: consent.marketing })
    setOpen(true)
  }
  const blocked = hydrated && hasGlobalPrivacyControl()
  const button = 'rounded border border-primary px-4 py-2 text-sm font-semibold text-foreground hover:bg-primary/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

  return <>
    {hydrated && !consent.decided && <section hidden={open} aria-label="Optional cookies and privacy"
      className="fixed bottom-0 inset-x-0 z-[80] border-t border-primary/40 bg-background p-5 shadow-2xl">
      <div className="mx-auto max-w-5xl flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl text-sm">
          <h2 className="font-heading text-lg font-bold mb-1">Your privacy choices</h2>
          <p>With your permission, Metricool measures site visits and Meta measures our advertising.
            Optional tracking stays off until you choose. Essential services still work.</p>
          <a href="/privacy#cookies" className="underline underline-offset-2">Read our privacy notice</a>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => choose({ analytics: false, marketing: false })}>Reject optional</button>
          <button type="button" className={button} onClick={() => choose({ analytics: true, marketing: true })}>Accept optional</button>
          <button type="button" className={button} onClick={manage}>Manage choices</button>
        </div>
      </div>
    </section>}
    <dialog ref={dialog} aria-labelledby="privacy-title"
      onCancel={event => { event.preventDefault(); close() }}
      className="w-[calc(100%-2rem)] max-w-lg rounded-xl border border-primary/40 bg-background p-6 text-foreground backdrop:bg-black/70">
      <h2 id="privacy-title" className="font-heading text-2xl font-bold mb-3">Privacy choices</h2>
      <p className="text-sm mb-4">Essential cookies support sign-in and cannot be switched off here.
        Optional choices are separate and can be changed at any time.</p>
      {blocked && <p className="mb-4 text-sm">Your browser’s Global Privacy Control signal is on. Optional tracking is off.</p>}
      <div className="space-y-4 mb-5">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" disabled={blocked}
          checked={draft.analytics && !blocked} onChange={event => setDraft({ ...draft, analytics: event.target.checked })} />
          <span><strong>Analytics: Metricool</strong><span className="block text-sm">Measure visits to public pages to improve the website.</span></span>
        </label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" disabled={blocked}
          checked={draft.marketing && !blocked} onChange={event => setDraft({ ...draft, marketing: event.target.checked })} />
          <span><strong>Marketing: Meta Pixel</strong><span className="block text-sm">Share public-page visits, referrer, browser/device information, IP address and cookie IDs with Meta to measure advertising. Meta may connect this information with your Meta account.</span></span>
        </label>
      </div>
      <p className="text-sm mb-5">We remember your choice in this browser for up to 180 days.
        Turning a category off reloads the page to stop loaded tracking code. This cannot undo data already sent.
        {' '}<a href="/privacy#cookies" className="underline">Privacy notice</a></p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => choose({ analytics: false, marketing: false })}>Reject optional</button>
        <button type="button" className={button} onClick={() => choose(draft)}>Save choices</button>
        <button type="button" className={button} onClick={close}>Cancel</button>
      </div>
    </dialog>
    <p role="status" className="sr-only">{message}</p>
  </>
}
