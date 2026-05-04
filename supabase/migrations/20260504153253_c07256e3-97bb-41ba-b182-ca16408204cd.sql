INSERT INTO public.check_configs (country_code, issue_type, label, severity, enabled)
VALUES
  ('de', 'wrong_country_redirect_url', 'Wrong Country Redirect URL', 'warning', true),
  ('pl', 'wrong_country_redirect_url', 'Wrong Country Redirect URL', 'warning', true)
ON CONFLICT DO NOTHING;