
-- Table to track URL check results and enable resume
CREATE TABLE public.url_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id_pool text NOT NULL,
  retailer_pool_id text,
  client_name text,
  assigned_email text,
  redirect_url text NOT NULL,
  http_status integer,
  error_message text,
  is_error boolean NOT NULL DEFAULT false,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  batch_id text NOT NULL,
  sheet_id text,
  sheet_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for resume capability
CREATE INDEX idx_url_check_batch ON public.url_check_results(batch_id);
CREATE INDEX idx_url_check_voucher ON public.url_check_results(voucher_id_pool);

ALTER TABLE public.url_check_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage url checks"
  ON public.url_check_results FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view url checks"
  ON public.url_check_results FOR SELECT TO authenticated
  USING (true);
