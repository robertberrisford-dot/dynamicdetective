-- Fix: status updates with NULL issue_id are invisible due to RLS JOIN failing
-- Drop old policies and replace with ones that handle NULL issue_id

DROP POLICY IF EXISTS "Users can view status updates on assigned issues" ON public.issue_status_updates;
DROP POLICY IF EXISTS "Users can add status updates on assigned issues" ON public.issue_status_updates;

-- SELECT: admins/ops_lead/team_lead see ALL updates; editors see only their own or assigned
CREATE POLICY "Users can view status updates"
ON public.issue_status_updates
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
  OR updated_by = auth.uid()
  OR (issue_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM issues WHERE issues.id = issue_status_updates.issue_id
    AND lower(issues.assigned_email) = lower(auth.email())
  ))
);

-- INSERT: authenticated users can insert their own updates
CREATE POLICY "Users can add status updates"
ON public.issue_status_updates
FOR INSERT
WITH CHECK (auth.uid() = updated_by);