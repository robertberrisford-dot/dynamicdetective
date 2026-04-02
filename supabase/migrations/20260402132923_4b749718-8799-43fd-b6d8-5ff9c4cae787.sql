
ALTER TABLE public.issues 
  ADD COLUMN IF NOT EXISTS voucher_id_pool TEXT,
  ADD COLUMN IF NOT EXISTS voucher_title TEXT,
  ADD COLUMN IF NOT EXISTS voucher_description TEXT,
  ADD COLUMN IF NOT EXISTS voucher_caption_1 TEXT,
  ADD COLUMN IF NOT EXISTS voucher_caption_2 TEXT,
  ADD COLUMN IF NOT EXISTS voucher_caption_text_1 TEXT,
  ADD COLUMN IF NOT EXISTS voucher_type TEXT,
  ADD COLUMN IF NOT EXISTS voucher_code TEXT,
  ADD COLUMN IF NOT EXISTS voucher_category TEXT,
  ADD COLUMN IF NOT EXISTS is_voucher_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS voucher_source TEXT,
  ADD COLUMN IF NOT EXISTS issue_type TEXT;
