-- Disposable database ONLY. Do not run against an existing application database.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
-- Emulate Supabase broad service-role defaults to prove new objects narrow them.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, display_name text);
CREATE TABLE public.host_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,session_id text,host_agent text NOT NULL,
 surface text NOT NULL,room_id text,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ended_at timestamptz,message_count integer NOT NULL DEFAULT 0
);
CREATE TABLE public.host_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES public.host_conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('user','assistant','system')),content text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION public.bump_message_count() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN UPDATE public.host_conversations SET message_count=message_count+1 WHERE id=NEW.conversation_id; RETURN NEW; END $$;
CREATE TRIGGER bump_count AFTER INSERT ON public.host_messages FOR EACH ROW EXECUTE FUNCTION public.bump_message_count();
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT ALL ON public.host_conversations,public.host_messages TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_messages ENABLE ROW LEVEL SECURITY;

-- Synthetic permissive fixture policy tests that unrelated profile edits stay usable.
GRANT SELECT,UPDATE(display_name) ON public.profiles TO authenticated;
CREATE POLICY fixture_profile_update ON public.profiles FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY fixture_profile_select ON public.profiles FOR SELECT TO authenticated USING(true);
