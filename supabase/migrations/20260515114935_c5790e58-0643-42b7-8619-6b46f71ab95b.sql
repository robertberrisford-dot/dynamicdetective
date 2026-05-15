INSERT INTO public.check_configs (country_code, issue_type, label, severity, enabled) VALUES
  ('de', 'html_in_tnc', 'HTML in T&C', 'warning', true),
  ('pl', 'html_in_tnc', 'HTML in T&C', 'warning', true)
ON CONFLICT DO NOTHING;