
-- EDITORS: scope SELECT
DROP POLICY IF EXISTS "Authenticated users can view editors" ON public.editors;
CREATE POLICY "Editors visible by self, substitute, or privileged"
ON public.editors FOR SELECT
TO authenticated
USING (
  lower(email) = lower(auth.email())
  OR lower(coalesce(vacation_substitute_email, '')) = lower(auth.email())
  OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
);

-- COUNTRY_CONFIGS: restrict full read to admin/ops_lead
DROP POLICY IF EXISTS "Authenticated users can view country configs" ON public.country_configs;
CREATE POLICY "Privileged users can view country configs"
ON public.country_configs FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role]));

-- Safe options helper for non-privileged users (only country_code + label + enabled)
CREATE OR REPLACE FUNCTION public.get_country_options()
RETURNS TABLE(country_code text, label text, enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT country_code, label, enabled
  FROM public.country_configs
  WHERE enabled = true
  ORDER BY label;
$$;
REVOKE ALL ON FUNCTION public.get_country_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_country_options() TO authenticated;

-- SYNC_SNAPSHOTS: restrict to privileged roles
DROP POLICY IF EXISTS "Authenticated users can view snapshots" ON public.sync_snapshots;
CREATE POLICY "Privileged users can view snapshots"
ON public.sync_snapshots FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role]));

-- URL_CHECK_RESULTS: restrict to admin/ops_lead (only edge functions consume these)
DROP POLICY IF EXISTS "Authenticated users can view url checks" ON public.url_check_results;
CREATE POLICY "Privileged users can view url checks"
ON public.url_check_results FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role]));
