-- DISPOSABLE TEST DATABASE ONLY. Reported production schedule shape, not a migration.
alter table public.cs_character_promo_delivery_plans alter column scheduled_at drop not null;
alter table public.cs_character_promo_delivery_plans add constraint cs_character_promo_delivery_schedule_guard CHECK (((status = 'blocked_assets'::text) OR (scheduled_at IS NOT NULL)));
