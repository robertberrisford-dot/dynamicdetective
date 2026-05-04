ALTER TABLE public.country_configs
  ADD COLUMN IF NOT EXISTS igraal_voucher_sheet_name text;

UPDATE public.country_configs SET igraal_voucher_sheet_name = 'iGraalDE_API_Vouchers(working)' WHERE country_code = 'de';
UPDATE public.country_configs SET igraal_voucher_sheet_name = 'iGraal - Voucher(Preset)' WHERE country_code = 'pl';

INSERT INTO public.check_configs (issue_type, label, country_code, enabled, severity)
VALUES
  ('code_missing_on_igraal', 'Code on main domain but missing on iGraal', 'de', true, 'issue'),
  ('code_missing_on_main', 'Code on iGraal but missing on main domain', 'de', true, 'issue'),
  ('code_missing_on_igraal', 'Code on main domain but missing on iGraal', 'pl', true, 'issue'),
  ('code_missing_on_main', 'Code on iGraal but missing on main domain', 'pl', true, 'issue')
ON CONFLICT DO NOTHING;