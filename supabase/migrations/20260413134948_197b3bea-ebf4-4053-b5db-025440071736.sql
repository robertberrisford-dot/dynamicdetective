
-- Add country column to editors table
ALTER TABLE public.editors ADD COLUMN IF NOT EXISTS country text DEFAULT 'de';

-- Update existing editors to be 'de' by default
UPDATE public.editors SET country = 'de' WHERE country IS NULL;

-- Create country_configs table
CREATE TABLE public.country_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text UNIQUE NOT NULL,
  label text NOT NULL,
  voucher_spreadsheet_id text NOT NULL,
  voucher_sheet_name text NOT NULL,
  editors_sheet_name text DEFAULT 'Editors',
  team_lead_email text,
  enabled boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.country_configs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view country configs
CREATE POLICY "Authenticated users can view country configs"
  ON public.country_configs FOR SELECT TO authenticated USING (true);

-- Admins can manage country configs
CREATE POLICY "Admins can manage country configs"
  ON public.country_configs FOR ALL TO public
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role]));

-- Seed DE and PL configs
INSERT INTO public.country_configs (country_code, label, voucher_spreadsheet_id, voucher_sheet_name, editors_sheet_name, team_lead_email)
VALUES
  ('de', 'Germany', '1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4', 'MYDEAL_DE_API_Vouchers (Preset)', 'Editors', 'thomas.punzel@atolls.com'),
  ('pl', 'Poland', '1ULEHlFn-1OqLLQIygMJG1g-qciugLLOe3dQkGl_Uzps', 'Pepper - Voucher(Preset)', 'editors', NULL);
