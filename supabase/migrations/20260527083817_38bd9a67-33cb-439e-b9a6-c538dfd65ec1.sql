INSERT INTO public.check_configs (country_code, issue_type, label, severity, enabled) VALUES
  ('de', 'past_month_in_title', 'Past month name in title', 'warning', true),
  ('pl', 'past_month_in_title', 'Past month name in title', 'warning', true),
  ('uk', 'past_month_in_title', 'Past month name in title', 'warning', true)
ON CONFLICT DO NOTHING;