CREATE OR REPLACE FUNCTION public.lounge_recent_msg_count(p_user_id uuid, p_room_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only your own Lounge message count is available' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::integer FROM public.lounge_messages
    WHERE user_id = p_user_id AND room_id = p_room_id
      AND created_at > now() - interval '1 minute' AND deleted_at IS NULL);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.lounge_recent_msg_count(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lounge_recent_msg_count(uuid,uuid) TO authenticated, service_role;
