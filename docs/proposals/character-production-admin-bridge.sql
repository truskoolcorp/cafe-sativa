-- DORMANT source-owner boolean bridge. Actor is trusted server identity, not a
-- caller assertion. This is current content-admin status, not owner consent.
BEGIN;
CREATE FUNCTION public.cs_cafe_metricool_is_admin(p_actor uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u
 WHERE u.id=p_actor AND u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC, anon, authenticated, service_role, character_production_generator, character_production_output_broker;
GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO character_production_owner;
COMMIT;
