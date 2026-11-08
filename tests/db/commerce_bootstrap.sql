-- Synthetic columns needed to run the ACTUAL checked-in commerce RPC bodies.
-- This is not an exact production schema: constraints/defaults are deliberately
-- limited to the tested receipt, idempotency and lock-order paths. Isolated only.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TYPE public.ticket_source AS ENUM ('tier_included','comp','purchased');
ALTER TABLE public.artists ADD COLUMN stripe_account_id text;
ALTER TABLE public.products ADD COLUMN title text DEFAULT 'Synthetic product',
 ADD COLUMN stock_count integer, ADD COLUMN kind text DEFAULT 'physical', ADD COLUMN digital_delivery_url text;
ALTER TABLE public.orders ADD COLUMN buyer_email text, ADD COLUMN stripe_checkout_session_id text UNIQUE,
 ADD COLUMN stripe_payment_intent_id text UNIQUE, ADD COLUMN subtotal_cents integer,
 ADD COLUMN shipping_cents integer, ADD COLUMN tax_cents integer, ADD COLUMN total_cents integer,
 ADD COLUMN currency text, ADD COLUMN shipping_name text, ADD COLUMN shipping_line1 text,
 ADD COLUMN shipping_line2 text, ADD COLUMN shipping_city text, ADD COLUMN shipping_state text,
 ADD COLUMN shipping_postal_code text, ADD COLUMN shipping_country text,
 ADD COLUMN fulfillment_state text, ADD COLUMN paid_at timestamptz;
ALTER TABLE public.order_items ADD COLUMN title_snapshot text, ADD COLUMN price_cents integer,
 ADD COLUMN quantity integer, ADD COLUMN line_total_cents integer, ADD COLUMN application_fee_cents integer,
 ADD COLUMN transfer_destination text;
ALTER TABLE public.events ADD COLUMN status text DEFAULT 'scheduled',
 ADD COLUMN starts_at timestamptz DEFAULT clock_timestamp()+interval '2 days',
 ADD COLUMN free_for_tiers text[] DEFAULT '{}', ADD COLUMN ticket_price_cents integer DEFAULT 500,
 ADD COLUMN capacity integer, ADD COLUMN title text DEFAULT 'Synthetic event', ADD COLUMN slug text;
ALTER TABLE public.tickets ADD COLUMN source public.ticket_source,
 ADD COLUMN state text DEFAULT 'valid', ADD COLUMN amount_paid_cents integer,
 ADD COLUMN stripe_payment_intent_id text UNIQUE, ADD COLUMN redeemed_at timestamptz,
 ADD COLUMN redemption_code text, ADD CONSTRAINT fixture_ticket_user_event UNIQUE(event_id,user_id);
ALTER TABLE public.cs_ticket_reservations ADD COLUMN amount_cents integer DEFAULT 500,
 ADD COLUMN state text DEFAULT 'held', ADD COLUMN created_at timestamptz DEFAULT clock_timestamp(),
 ADD COLUMN expires_at timestamptz DEFAULT clock_timestamp()+interval '40 minutes',
 ADD COLUMN checkout_expires_at timestamptz DEFAULT clock_timestamp()+interval '35 minutes',
 ADD COLUMN stripe_session_id text UNIQUE, ADD COLUMN stripe_payment_intent_id text UNIQUE,
 ADD COLUMN attention_reason text;
ALTER TABLE public.memberships ADD CONSTRAINT fixture_membership_user UNIQUE(user_id);
