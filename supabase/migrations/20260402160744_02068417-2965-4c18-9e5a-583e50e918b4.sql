ALTER TABLE public.issues ADD COLUMN hidden_until timestamp with time zone DEFAULT NULL;
ALTER TABLE public.issues ADD COLUMN voucher_start_date text DEFAULT NULL;