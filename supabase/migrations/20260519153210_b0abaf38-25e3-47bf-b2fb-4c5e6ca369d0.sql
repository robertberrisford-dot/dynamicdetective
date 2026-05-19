INSERT INTO public.check_configs (country_code, issue_type, label, severity, enabled) VALUES
('de','deal_blocking_real_code','Deal at position 1 blocks real code','warning',true),
('pl','deal_blocking_real_code','Deal at position 1 blocks real code','warning',true),
('uk','deal_blocking_real_code','Deal at position 1 blocks real code','warning',true)
ON CONFLICT (country_code, issue_type) DO NOTHING;