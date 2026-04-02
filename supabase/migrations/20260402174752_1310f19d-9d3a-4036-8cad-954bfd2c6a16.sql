
CREATE TABLE public.sync_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id text NOT NULL,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  editor_email text,
  issue_type text NOT NULL,
  issue_count integer NOT NULL DEFAULT 0,
  issues_resolved integer NOT NULL DEFAULT 0,
  issues_disappeared integer NOT NULL DEFAULT 0,
  issues_new integer NOT NULL DEFAULT 0
);

ALTER TABLE public.sync_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view snapshots"
  ON public.sync_snapshots FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage snapshots"
  ON public.sync_snapshots FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_sync_snapshots_synced_at ON public.sync_snapshots(synced_at);
CREATE INDEX idx_sync_snapshots_editor ON public.sync_snapshots(editor_email);
