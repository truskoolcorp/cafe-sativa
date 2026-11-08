-- Disposable isolated Auth-service fixture ONLY, not an application migration.
-- Public portion adapted from tests/db/bootstrap.sql on 2026-11-08.
-- GoTrue itself creates all Auth tables, keys, functions and migrations.
-- Abbreviated Café public columns/FKs/triggers are NOT a hosted schema export.
-- No Auth table DDL or user/session/identity inserts are permitted in this fixture.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO service_role;
CREATE TABLE public.artists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,updated_at timestamptz);
CREATE TABLE public.content_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_job_id uuid,updated_at timestamptz);
CREATE TABLE public.cs_canonical_assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),approved_by uuid);
CREATE TABLE public.cs_content_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),canonical_asset_id uuid,qa_approved_by uuid);
CREATE TABLE public.cs_episode_script_approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),approved_by uuid);
CREATE TABLE public.cs_social_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid);
CREATE TABLE public.cs_social_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),approved_by uuid,content_item_id uuid,source_job_id uuid);
CREATE TABLE public.cs_ticket_reservations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,ticket_id uuid,user_id uuid);
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.host_conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,session_id text,host_agent text NOT NULL,surface text NOT NULL,room_id text,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),ended_at timestamptz,message_count integer NOT NULL DEFAULT 0);
CREATE TABLE public.host_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('user','assistant','system')),content text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.lounge_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),deleted_by uuid,room_id uuid,user_id uuid,author_name text,author_tier text,is_staff boolean,content text DEFAULT 'synthetic',created_at timestamptz DEFAULT clock_timestamp(),deleted_at timestamptz);
CREATE TABLE public.lounge_rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tier text DEFAULT 'explorer',status text DEFAULT 'active',current_period_end timestamptz DEFAULT clock_timestamp()+interval '1 day',updated_at timestamptz);
CREATE TABLE public.order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artist_id uuid,order_id uuid,product_id uuid);
CREATE TABLE public.orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,updated_at timestamptz);
CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artist_id uuid,updated_at timestamptz);
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,display_name text,avatar_url text,is_admin boolean NOT NULL DEFAULT false,is_staff boolean NOT NULL DEFAULT false,updated_at timestamptz);
CREATE TABLE public.publish_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_item_id uuid);
CREATE TABLE public.room_state (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),active_event_id uuid,updated_by uuid,updated_at timestamptz);
CREATE TABLE public.tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,user_id uuid);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.room_state ADD CONSTRAINT room_state_active_event_id_fkey FOREIGN KEY (active_event_id) REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE public.room_state ADD CONSTRAINT room_state_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.host_conversations ADD CONSTRAINT host_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.cs_social_deliveries ADD CONSTRAINT cs_social_deliveries_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES content_items(id);
ALTER TABLE public.host_messages ADD CONSTRAINT host_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES host_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.artists ADD CONSTRAINT artists_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE RESTRICT;
ALTER TABLE public.lounge_messages ADD CONSTRAINT lounge_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES lounge_rooms(id) ON DELETE CASCADE;
ALTER TABLE public.lounge_messages ADD CONSTRAINT lounge_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.lounge_messages ADD CONSTRAINT lounge_messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
ALTER TABLE public.publish_log ADD CONSTRAINT publish_log_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE SET NULL;
ALTER TABLE public.cs_canonical_assets ADD CONSTRAINT cs_canonical_assets_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);
ALTER TABLE public.cs_content_jobs ADD CONSTRAINT cs_content_jobs_canonical_asset_id_fkey FOREIGN KEY (canonical_asset_id) REFERENCES cs_canonical_assets(id);
ALTER TABLE public.cs_content_jobs ADD CONSTRAINT cs_content_jobs_qa_approved_by_fkey FOREIGN KEY (qa_approved_by) REFERENCES auth.users(id);
ALTER TABLE public.cs_social_deliveries ADD CONSTRAINT cs_social_deliveries_source_job_id_fkey FOREIGN KEY (source_job_id) REFERENCES cs_content_jobs(id);
ALTER TABLE public.cs_social_deliveries ADD CONSTRAINT cs_social_deliveries_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);
ALTER TABLE public.content_items ADD CONSTRAINT content_items_source_job_id_fkey FOREIGN KEY (source_job_id) REFERENCES cs_content_jobs(id);
ALTER TABLE public.cs_social_connections ADD CONSTRAINT cs_social_connections_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
ALTER TABLE public.cs_ticket_reservations ADD CONSTRAINT cs_ticket_reservations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE public.cs_ticket_reservations ADD CONSTRAINT cs_ticket_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.cs_ticket_reservations ADD CONSTRAINT cs_ticket_reservations_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id);
ALTER TABLE public.cs_episode_script_approvals ADD CONSTRAINT cs_episode_script_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES profiles(id);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lounge_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_canonical_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_social_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_ticket_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_episode_script_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_log ENABLE ROW LEVEL SECURITY;

-- Relevant existing trigger behavior, not an export of every production column.
-- handle_new_user body/security/ACL matches the read-only catalog on 2026-11-08.
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE FUNCTION public.bump_message_count() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN UPDATE public.host_conversations SET message_count=message_count+1 WHERE id=NEW.conversation_id; RETURN NEW; END $$;
CREATE TRIGGER host_messages_bump_count AFTER INSERT ON public.host_messages FOR EACH ROW EXECUTE FUNCTION public.bump_message_count();
CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER memberships_touch_updated_at BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER room_state_touch_updated_at BEFORE UPDATE ON public.room_state FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER artists_touch BEFORE UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER content_items_updated_at BEFORE UPDATE ON public.content_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_lounge_message_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); staff boolean; display text; tier text; recent integer;
BEGIN
  IF actor IS NULL THEN RAISE insufficient_privilege USING MESSAGE = 'Sign in to write Lounge messages'; END IF;
  SELECT coalesce(p.is_staff OR p.is_admin,false),coalesce(nullif(btrim(p.display_name),''),'Member')
    INTO staff,display FROM public.profiles p WHERE p.id=actor;
  staff := coalesce(staff,false);
  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id <> actor AND NOT staff THEN RAISE insufficient_privilege USING MESSAGE='Message ownership required'; END IF;
    IF (NEW.id,NEW.room_id,NEW.user_id,NEW.author_name,NEW.author_tier,NEW.is_staff,NEW.content,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.room_id,OLD.user_id,OLD.author_name,OLD.author_tier,OLD.is_staff,OLD.content,OLD.created_at)
      OR OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
      RAISE insufficient_privilege USING MESSAGE='Only soft deletion is permitted';
    END IF;
    NEW.deleted_at := clock_timestamp(); NEW.deleted_by := actor;
    RETURN NEW;
  END IF;
  IF NEW.user_id <> actor THEN RAISE insufficient_privilege USING MESSAGE='Message ownership required'; END IF;
  NEW.content := btrim(NEW.content);
  IF NEW.content IS NULL OR char_length(NEW.content) NOT BETWEEN 1 AND 2000 THEN
    RAISE check_violation USING MESSAGE='Message must contain 1 to 2000 characters';
  END IF;
  -- Serialize every insert for the same author/room. Deleted messages count too.
  PERFORM pg_advisory_xact_lock(hashtextextended('lounge-write:'||actor::text||':'||NEW.room_id::text,0));
  SELECT count(*) INTO recent FROM public.lounge_messages
    WHERE user_id=actor AND room_id=NEW.room_id AND created_at > clock_timestamp()-interval '1 minute';
  IF recent >= 10 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='lounge_rate_limited'; END IF;
  SELECT m.tier::text INTO tier FROM public.memberships m WHERE m.user_id=actor AND m.status='active' AND m.current_period_end > now();
  NEW.author_name := coalesce(display,'Member'); NEW.author_tier := coalesce(tier,'explorer'); NEW.is_staff := staff;
  NEW.created_at := clock_timestamp(); NEW.deleted_at := NULL; NEW.deleted_by := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_lounge_message_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lounge_message_write_guard BEFORE INSERT OR UPDATE ON public.lounge_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_lounge_message_write();
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,supabase_auth_admin;
-- No public-table grants to supabase_auth_admin, no auth-table grants to service_role.
GRANT SELECT,UPDATE(display_name,avatar_url) ON public.profiles TO authenticated;
CREATE POLICY fixture_profile_update ON public.profiles FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY fixture_profile_select ON public.profiles FOR SELECT TO authenticated USING(true);

