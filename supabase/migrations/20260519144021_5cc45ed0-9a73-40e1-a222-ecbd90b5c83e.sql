CREATE TABLE public.pending_sync_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  country_code text NOT NULL,
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pending_sync_issues_run_id ON public.pending_sync_issues(run_id);
ALTER TABLE public.pending_sync_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage pending_sync_issues" ON public.pending_sync_issues
  FOR ALL USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role]));