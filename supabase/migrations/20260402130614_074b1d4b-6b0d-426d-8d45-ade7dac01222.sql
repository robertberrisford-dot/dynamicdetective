
CREATE TABLE public.retailers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  retailer_pool_id TEXT,
  old_merchant_id TEXT,
  client_id TEXT,
  client_name TEXT,
  merchant_quality TEXT,
  published TEXT,
  page_published TEXT,
  indexed TEXT,
  affiliate_network TEXT,
  active_vouchers TEXT,
  active_codes TEXT,
  active_deals TEXT,
  seo_url TEXT,
  retailer_seo_title TEXT,
  retailer_seo_desc TEXT,
  logo_alt_text TEXT,
  ranking_algorithm TEXT,
  retailer_url_anchor TEXT,
  retailer_url TEXT,
  client TEXT,
  country TEXT,
  keyword_1 TEXT,
  keyword_2 TEXT,
  keyword_3 TEXT,
  keyword_4 TEXT,
  categories TEXT,
  retailer_assignment TEXT,
  dynamic_vouchers TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(retailer_pool_id)
);

ALTER TABLE public.retailers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view retailers"
  ON public.retailers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage retailers"
  ON public.retailers FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_retailers_updated_at
  BEFORE UPDATE ON public.retailers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
