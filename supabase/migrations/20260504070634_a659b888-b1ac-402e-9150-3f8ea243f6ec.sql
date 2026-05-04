ALTER TABLE public.country_configs
ADD COLUMN retailer_spreadsheet_id text,
ADD COLUMN retailer_sheet_name text;

UPDATE public.country_configs
SET retailer_spreadsheet_id = '1fgzLXv6jxCprt_3tvBBVCsf1snOXzm9jMeJkgza5NUE',
    retailer_sheet_name = CASE
      WHEN country_code = 'de' THEN 'DE Retailer'
      WHEN country_code = 'pl' THEN 'PL Retailer'
      ELSE retailer_sheet_name
    END
WHERE country_code IN ('de', 'pl');

ALTER TABLE public.country_configs
ALTER COLUMN retailer_spreadsheet_id SET NOT NULL,
ALTER COLUMN retailer_sheet_name SET NOT NULL;