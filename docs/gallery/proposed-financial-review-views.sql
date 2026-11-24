-- Proposed service-only report sources. Apply after house checkout, refund ledger
-- and settlement observations. No client grants, stock adjustments or payouts.
begin;
create view public.gallery_order_financial_review with (security_invoker=true) as
select o.id as order_id, i.artist_id, i.product_id, i.title_snapshot, o.currency,
 o.paid_at, o.fulfillment_state, i.quantity, i.line_total_cents,
 case when i.gallery_sale_kind='house' then 'house' else 'consigned' end as sale_kind,
 i.application_fee_cents as recorded_commission_cents,
 s.observed_at, s.provider_snapshot->'livemode' as provider_livemode,
 case when s.id is null then 'unobserved'
      when jsonb_typeof(s.provider_snapshot#>'{order_comparison,attention}') is distinct from 'array' then 'incomplete'
      when jsonb_array_length(s.provider_snapshot#>'{order_comparison,attention}')>0 then 'attention'
      else 'observed' end as evidence_state,
 jsonb_build_object(
 -- Original expectation is derived from the recorded artwork line, even before provider observation.
 'expected_original_commission_cents',case when i.line_total_cents>0 then
   case when i.gallery_sale_kind='house' then 0 else floor(i.line_total_cents::numeric/10)::bigint end end,
 'expected_original_artist_cents',case when i.line_total_cents>0 then
   case when i.gallery_sale_kind='house' then 0 else i.line_total_cents-floor(i.line_total_cents::numeric/10)::bigint end end,
 'captured_cents',s.provider_snapshot->'captured_cents',
 'refunded_cents',s.provider_snapshot->'refunded_cents',
 'expected_remaining_commission_cents',s.provider_snapshot#>'{order_comparison,expected_remaining_commission_cents}',
 'expected_remaining_artist_cents',s.provider_snapshot#>'{order_comparison,expected_remaining_artist_cents}',
 'gross_transfer_cents',s.provider_snapshot->'transfer_cents',
 'original_application_fee_cents',s.provider_snapshot->'application_fee_cents',
 'artist_connect_allocation_cents',s.provider_snapshot->'observed_artist_connect_allocation_cents',
 'platform_application_fee_cents',s.provider_snapshot->'observed_platform_application_fee_cents',
 'processing_fees_cents',s.provider_snapshot->'observed_charge_refund_balance_fee_cents',
 'transfer_reversed_cents',s.provider_snapshot->'transfer_reversed_cents',
 'application_fee_refunded_cents',s.provider_snapshot->'application_fee_refunded_cents',
 'platform_after_charge_refund_fees_cents',s.provider_snapshot#>'{order_comparison,observed_platform_after_charge_refund_fees_cents}',
 'attention',s.provider_snapshot#>'{order_comparison,attention}'
 ) as financial_evidence
from public.orders o
join public.order_items i on i.order_id=o.id
left join lateral (
 select obs.* from public.gallery_settlement_observations obs
 where obs.order_id=o.id and obs.stripe_payment_intent_id=o.stripe_payment_intent_id
   and obs.provider_snapshot->>'currency'=o.currency
   and obs.provider_snapshot->>'sale_kind'=case when i.gallery_sale_kind='house' then 'house' else 'consigned' end
 order by obs.observed_at desc,obs.id desc limit 1
) s on true
where o.paid_at is not null and i.artist_id is not null and i.product_id is not null
 and (select count(*) from public.order_items oi where oi.order_id=o.id)=1;
revoke all on public.gallery_order_financial_review from public,anon,authenticated,service_role;
grant select on public.gallery_order_financial_review to service_role;

-- Review queue source only. Do not infer permission to restock from a refund.
-- Digital copies already delivered cannot be recovered; limited edition review
-- must be explicit even after a confirmed full refund.
create view public.gallery_refund_review_candidates with (security_invoker=true) as
select o.id as order_id, i.product_id,i.artist_id, p.kind::text as product_kind,
 i.quantity, o.currency,o.total_cents, r.succeeded_cents as succeeded_refund_cents,
 p.stock_count, coalesce(rr.state,'not_reviewed') as review_state,
 case when coalesce(r.succeeded_cents,0)<>o.total_cents then 'provider_refund_evidence_incomplete'
      when p.stock_count is null then 'unlimited_no_restock'
      when p.kind::text='digital' then 'digital_edition_manual_review'
      when p.kind::text='physical' then 'physical_return_manual_review'
      else 'unsupported_manual_review' end as review_reason
from public.orders o join public.order_items i on i.order_id=o.id
join public.products p on p.id=i.product_id
left join public.gallery_restock_reviews rr on rr.order_id=o.id
left join lateral (
 select sum(f.amount_cents) as succeeded_cents from public.gallery_refund_receipts f
 where f.order_id=o.id and f.stripe_payment_intent_id=o.stripe_payment_intent_id
 and f.currency=o.currency and f.provider_status='succeeded'
) r on true
where o.paid_at is not null and o.fulfillment_state::text='refunded'
 and o.total_cents>0 and (select count(*) from public.order_items oi where oi.order_id=o.id)=1;
revoke all on public.gallery_refund_review_candidates from public,anon,authenticated,service_role;
grant select on public.gallery_refund_review_candidates to service_role;
commit;
