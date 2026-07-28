INSERT INTO public.check_configs (country_code, issue_type, label, enabled, severity)
VALUES
  ('de', 'low_engagement_page', 'Low-engagement landing page', true, 'warning'),
  ('pl', 'low_engagement_page', 'Low-engagement landing page', false, 'warning'),
  ('uk', 'low_engagement_page', 'Low-engagement landing page', false, 'warning')
ON CONFLICT (country_code, issue_type) DO NOTHING;