INSERT INTO public.check_configs (country_code, issue_type, label, enabled, severity)
VALUES
  ('de', 'automatic_source_review', 'Automatic Source Review', true, 'warning'),
  ('pl', 'automatic_source_review', 'Automatic Source Review', true, 'warning'),
  ('uk', 'automatic_source_review', 'Automatic Source Review', true, 'warning')
ON CONFLICT DO NOTHING;