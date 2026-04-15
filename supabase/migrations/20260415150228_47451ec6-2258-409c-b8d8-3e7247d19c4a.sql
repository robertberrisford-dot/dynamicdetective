
-- Table to store which issue checks are enabled per country
CREATE TABLE public.check_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'de',
  issue_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (country_code, issue_type)
);

ALTER TABLE public.check_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view check configs"
  ON public.check_configs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and ops leads can manage check configs"
  ON public.check_configs FOR ALL TO public
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role]));

CREATE TRIGGER update_check_configs_updated_at
  BEFORE UPDATE ON public.check_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default configs for 'de' (all enabled)
INSERT INTO public.check_configs (country_code, issue_type, label, enabled) VALUES
  ('de', 'missing_caption_1', 'Non-Numerical Caption 1', true),
  ('de', 'metas_without_values', 'Metas Without Values', true),
  ('de', 'broken_redirect_url', 'Broken Redirect URLs', true),
  ('de', 'repeated_caption_1', 'Repeated Caption 1', true),
  ('de', 'repeated_caption_combo', 'Repeated Caption 1+2', true),
  ('de', 'stale_evergreen', 'Stale Evergreen Vouchers', true),
  ('de', 'abc_missing_tnc', 'ABC Missing T&C', true),
  ('de', 'abc_repeated_tnc', 'ABC Repeated T&C', false),
  ('de', 'duplicate_code', 'Duplicate Codes', true),
  ('de', 'caption_title_mismatch', 'Caption-Title Mismatch', true),
  ('de', 'multiple_manual_picks', 'Multiple Manual Picks', true),
  ('de', 'similar_titles', 'Similar Titles', true),
  ('pl', 'missing_caption_1', 'Non-Numerical Caption 1', true),
  ('pl', 'metas_without_values', 'Metas Without Values', true),
  ('pl', 'broken_redirect_url', 'Broken Redirect URLs', true),
  ('pl', 'repeated_caption_1', 'Repeated Caption 1', true),
  ('pl', 'repeated_caption_combo', 'Repeated Caption 1+2', true),
  ('pl', 'stale_evergreen', 'Stale Evergreen Vouchers', true),
  ('pl', 'abc_missing_tnc', 'ABC Missing T&C', true),
  ('pl', 'abc_repeated_tnc', 'ABC Repeated T&C', false),
  ('pl', 'duplicate_code', 'Duplicate Codes', true),
  ('pl', 'caption_title_mismatch', 'Caption-Title Mismatch', true),
  ('pl', 'multiple_manual_picks', 'Multiple Manual Picks', true),
  ('pl', 'similar_titles', 'Similar Titles', true);
