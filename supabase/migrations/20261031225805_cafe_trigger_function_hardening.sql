-- All object references in these existing bodies are already schema-qualified.
-- Change function configuration/ACLs only; preserve OIDs, bodies and trigger bindings.
ALTER FUNCTION public.bump_message_count() SET search_path = '';
ALTER FUNCTION public.touch_updated_at() SET search_path = '';
ALTER FUNCTION public.update_updated_at() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';

-- These functions return trigger and are internal hooks, not public RPCs.
REVOKE EXECUTE ON FUNCTION public.fn_passport_welcome_email(), public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_passport_welcome_email(), public.handle_new_user() TO service_role;
