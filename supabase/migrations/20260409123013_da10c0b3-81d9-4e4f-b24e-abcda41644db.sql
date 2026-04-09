
-- Helper: check if user has any of the given roles
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  )
$$;

-- Update user_roles policies
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Ops leads and admins can manage roles"
  ON public.user_roles FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Ops leads and admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

-- Update issues policies
DROP POLICY IF EXISTS "Users can view assigned issues" ON public.issues;
CREATE POLICY "Users can view assigned issues"
  ON public.issues FOR SELECT
  USING (
    lower(assigned_email) = lower(auth.email())
    OR has_any_role(auth.uid(), ARRAY['admin','ops_lead','team_lead']::app_role[])
  );

DROP POLICY IF EXISTS "Users can update assigned issues" ON public.issues;
CREATE POLICY "Users can update assigned issues"
  ON public.issues FOR UPDATE
  USING (
    lower(assigned_email) = lower(auth.email())
    OR has_any_role(auth.uid(), ARRAY['admin','ops_lead','team_lead']::app_role[])
  );

-- Update comments policies
DROP POLICY IF EXISTS "Users can view comments on assigned issues" ON public.comments;
CREATE POLICY "Users can view comments on assigned issues"
  ON public.comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM issues WHERE issues.id = comments.issue_id
        AND (lower(issues.assigned_email) = lower(auth.email())
             OR has_any_role(auth.uid(), ARRAY['admin','ops_lead','team_lead']::app_role[]))
    )
  );

DROP POLICY IF EXISTS "Users can add comments on assigned issues" ON public.comments;
CREATE POLICY "Users can add comments on assigned issues"
  ON public.comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM issues WHERE issues.id = comments.issue_id
        AND (lower(issues.assigned_email) = lower(auth.email())
             OR has_any_role(auth.uid(), ARRAY['admin','ops_lead','team_lead']::app_role[]))
    )
  );

-- Update issue_status_updates policies
DROP POLICY IF EXISTS "Users can view status updates on assigned issues" ON public.issue_status_updates;
CREATE POLICY "Users can view status updates on assigned issues"
  ON public.issue_status_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM issues WHERE issues.id = issue_status_updates.issue_id
        AND (lower(issues.assigned_email) = lower(auth.email())
             OR has_any_role(auth.uid(), ARRAY['admin','ops_lead','team_lead']::app_role[]))
    )
  );

DROP POLICY IF EXISTS "Users can add status updates on assigned issues" ON public.issue_status_updates;
CREATE POLICY "Users can add status updates on assigned issues"
  ON public.issue_status_updates FOR INSERT
  WITH CHECK (
    auth.uid() = updated_by
    AND EXISTS (
      SELECT 1 FROM issues WHERE issues.id = issue_status_updates.issue_id
        AND (lower(issues.assigned_email) = lower(auth.email())
             OR has_any_role(auth.uid(), ARRAY['admin','ops_lead','team_lead']::app_role[]))
    )
  );

-- Update sync_logs
DROP POLICY IF EXISTS "Admins can manage sync_logs" ON public.sync_logs;
CREATE POLICY "Ops leads and admins can manage sync_logs"
  ON public.sync_logs FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

CREATE POLICY "Team leads can view sync_logs"
  ON public.sync_logs FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['team_lead']::app_role[]));

-- Update issues insert/delete for ops_lead
DROP POLICY IF EXISTS "Admins can insert issues" ON public.issues;
CREATE POLICY "Admins and ops leads can insert issues"
  ON public.issues FOR INSERT
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

DROP POLICY IF EXISTS "Admins can delete issues" ON public.issues;
CREATE POLICY "Admins and ops leads can delete issues"
  ON public.issues FOR DELETE
  USING (has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));
