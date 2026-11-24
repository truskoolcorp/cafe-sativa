'use client'
import {useEffect,useState} from 'react'
import {reportAmount,reportEvidence,refundReviewReason} from '@/lib/gallery/financial-review-display'

type Scope = 'artist'|'owner'
type Order = {order_id:string,title_snapshot:string,currency:string,sale_kind:string,
  quantity:number,line_total_cents:number,recorded_commission_cents:number|null,
  observed_at:string|null,evidence_state:string,financial_evidence:Record<string,unknown>|null}
type Refund = {order_id:string,currency:string,total_cents:number,succeeded_refund_cents:number|null,
  review_reason:string,review_state:string}
type Report = {scope:Scope,mode:'isolated-test',orders:Order[],refund_review:Refund[],more_orders:boolean,more_refunds:boolean}
type Result = {scope:Scope,report?:Report,error?:string}
export default function FinancialReview(){
  const [scope,setScope]=useState<Scope>('artist')
  const [result,setResult]=useState<Result|null>(null)
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    const abort=new AbortController()
    setResult(null)
    async function load(){
      try {
        const response=await fetch('/api/gallery/financial-review?scope='+scope,{cache:'no-store',signal:abort.signal})
        if(!response.ok)throw new Error('unavailable')
        const report:Report=await response.json()
        if(report.scope!==scope||report.mode!=='isolated-test'||!Array.isArray(report.orders)||!Array.isArray(report.refund_review))throw new Error('invalid')
        if(!abort.signal.aborted)setResult({scope,report})
      }catch{
        if(!abort.signal.aborted)setResult({scope,error:'Report unavailable. Sign in with an authorized test account.'})
      }
    }
    void load()
    return ()=>abort.abort()
  },[scope,revision])
  const current=result?.scope===scope?result:null
  const report=current?.report
  const fields=(order:Order):[string,unknown][]=>[
    ['Artwork total',order.line_total_cents],
    ['Expected original commission',order.financial_evidence?.expected_original_commission_cents],
    ['Recorded commission',order.recorded_commission_cents],
    ['Expected original artist allocation',order.financial_evidence?.expected_original_artist_cents],
    ['Expected remaining commission',order.financial_evidence?.expected_remaining_commission_cents],
    ['Expected remaining artist allocation',order.financial_evidence?.expected_remaining_artist_cents],
    ['Observed gross transfer',order.financial_evidence?.gross_transfer_cents],
    ['Observed original application fee',order.financial_evidence?.original_application_fee_cents],
    ['Observed artist Connect allocation',order.financial_evidence?.artist_connect_allocation_cents],
    ['Observed platform application fee',order.financial_evidence?.platform_application_fee_cents],
    ['Observed processing fees',order.financial_evidence?.processing_fees_cents],
    ['Observed transfer reversals',order.financial_evidence?.transfer_reversed_cents],
    ['Observed refunded application fees',order.financial_evidence?.application_fee_refunded_cents],
    ['Captured',order.financial_evidence?.captured_cents],
    ['Refunded',order.financial_evidence?.refunded_cents],
    ['Observed platform amount after charge/refund fees',order.financial_evidence?.platform_after_charge_refund_fees_cents]
  ]
  return <section className="space-y-6">
    <header>
      <p className="text-sm text-primary">Isolated test environment · read only</p>
      <h1 className="font-heading text-3xl font-bold mt-2">Gallery financial review</h1>
      <p className="text-muted-foreground mt-2">Expected allocations and observed provider evidence are separate. Neither is a bank payout or total profit. Missing amounts are unknown, not zero. House sales have no independent artist allocation; Connect fields are not applicable to house sales.</p>
    </header>
    <div className="flex flex-wrap gap-3">
      <button type="button" aria-pressed={scope==='artist'} onClick={()=>{if(scope!=='artist'){setResult(null);setScope('artist')}}} className="border rounded px-4 py-2">Artist report</button>
      <button type="button" aria-pressed={scope==='owner'} onClick={()=>{if(scope!=='owner'){setResult(null);setScope('owner')}}} className="border rounded px-4 py-2">Owner review</button>
      <button type="button" onClick={()=>{setResult(null);setRevision(x=>x+1)}} className="border rounded px-4 py-2">Refresh</button>
    </div>
    <div aria-live="polite">
      {!current&&<p>Loading authorized report…</p>}
      {current?.error&&<p role="alert">{current.error}</p>}
      {report&&<div className="space-y-5">
        <h2 className="text-xl font-semibold">{scope==='owner'?'All authorized test orders':'Your consigned test orders'}</h2>
        {report.orders.length===0&&<p>No orders to review.</p>}
        {report.orders.map(order=><article key={order.order_id} className="rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold break-words">{order.title_snapshot}</h3>
          <p className="text-sm text-muted-foreground">{order.sale_kind==='house'?'House sale':'Consigned sale'} · Quantity {order.quantity} · {reportEvidence(order.evidence_state)}</p>
          {order.observed_at&&<p className="text-sm text-muted-foreground">Provider snapshot: <time dateTime={order.observed_at}>{order.observed_at}</time></p>}
          {order.financial_evidence?.refund_evidence_mismatch===true&&<p className="text-sm" role="status">Refund evidence differs from the latest settlement snapshot. Review required; displayed provider amounts are historical.</p>}
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields(order).map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="font-medium">{reportAmount(value,order.currency)}</dd></div>)}
          </dl>
        </article>)}
        {report.more_orders&&<p>Only the first 100 orders are shown. This is not a complete ledger.</p>}
        {scope==='owner'&&<section className="space-y-3">
          <h2 className="text-xl font-semibold">Refund and restock review</h2>
          <p className="text-sm text-muted-foreground">Read only. No inventory is restored by this report.</p>
          {report.refund_review.length===0&&<p>No refund review candidates.</p>}
          {report.refund_review.map(row=><article key={row.order_id} className="rounded border p-4">
            <p className="font-medium">{refundReviewReason(row.review_reason)}</p>
            <p className="text-sm break-all">Order {row.order_id}</p>
            <p className="text-sm">Recorded successful refund: {reportAmount(row.succeeded_refund_cents,row.currency)} / {reportAmount(row.total_cents,row.currency)}</p>
          </article>)}
          {report.more_refunds&&<p>Only the first 100 refund candidates are shown.</p>}
        </section>}
      </div>}
    </div>
  </section>
}
