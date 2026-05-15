INSERT INTO public.check_configs (country_code, issue_type, label, severity, enabled) VALUES
('de', 'action_code_blocking_real_code', 'Action code at position 1 blocks real code', 'issue', true),
('pl', 'action_code_blocking_real_code', 'Action code at position 1 blocks real code', 'issue', true)
ON CONFLICT DO NOTHING;