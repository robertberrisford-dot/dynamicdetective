INSERT INTO public.check_configs (country_code, issue_type, enabled, severity, label) VALUES
  ('de','migration_missing_tnc', true,  'warning', 'Migration prep: missing T&Cs'),
  ('de','migration_generic_tnc', true,  'warning', 'Migration prep: generic T&Cs'),
  ('uk','migration_missing_tnc', false, 'warning', 'Migration prep: missing T&Cs'),
  ('uk','migration_generic_tnc', false, 'warning', 'Migration prep: generic T&Cs'),
  ('pl','migration_missing_tnc', false, 'warning', 'Migration prep: missing T&Cs'),
  ('pl','migration_generic_tnc', false, 'warning', 'Migration prep: generic T&Cs')
ON CONFLICT (country_code, issue_type) DO NOTHING;