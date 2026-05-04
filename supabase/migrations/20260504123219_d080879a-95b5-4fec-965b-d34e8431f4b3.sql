ALTER TABLE public.country_configs ADD COLUMN IF NOT EXISTS igraal_retailer_sheet_name text;

UPDATE public.country_configs
SET retailer_sheet_name = 'DE Retailer MYD',
    igraal_retailer_sheet_name = 'DE Retailer Igraal'
WHERE country_code = 'de';

UPDATE public.country_configs
SET retailer_sheet_name = 'PL Retailer Pepper',
    igraal_retailer_sheet_name = 'PL Retailer Igraal'
WHERE country_code = 'pl';