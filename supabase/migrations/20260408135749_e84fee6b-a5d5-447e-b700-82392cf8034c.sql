
-- Drop old CASCADE foreign keys
ALTER TABLE public.issue_status_updates DROP CONSTRAINT issue_status_updates_issue_id_fkey;
ALTER TABLE public.comments DROP CONSTRAINT comments_issue_id_fkey;

-- Make issue_id nullable on both tables
ALTER TABLE public.issue_status_updates ALTER COLUMN issue_id DROP NOT NULL;
ALTER TABLE public.comments ALTER COLUMN issue_id DROP NOT NULL;

-- Re-add foreign keys with SET NULL instead of CASCADE
ALTER TABLE public.issue_status_updates 
  ADD CONSTRAINT issue_status_updates_issue_id_fkey 
  FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE SET NULL;

ALTER TABLE public.comments 
  ADD CONSTRAINT comments_issue_id_fkey 
  FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE SET NULL;

-- Add stable identifier columns to issue_status_updates for analytics
ALTER TABLE public.issue_status_updates ADD COLUMN issue_type text;
ALTER TABLE public.issue_status_updates ADD COLUMN retailer_pool_id text;
ALTER TABLE public.issue_status_updates ADD COLUMN voucher_id_pool text;
ALTER TABLE public.issue_status_updates ADD COLUMN client_name text;
ALTER TABLE public.issue_status_updates ADD COLUMN assigned_email_snapshot text;

-- Add stable identifier columns to comments
ALTER TABLE public.comments ADD COLUMN retailer_pool_id text;
ALTER TABLE public.comments ADD COLUMN voucher_id_pool text;
