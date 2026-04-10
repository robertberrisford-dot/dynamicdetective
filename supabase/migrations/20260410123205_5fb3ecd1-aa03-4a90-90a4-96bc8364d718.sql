
-- Create a helper function to check if the current user is a vacation substitute for a given email
CREATE OR REPLACE FUNCTION public.is_vacation_substitute(_assigned_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.editors
    WHERE lower(email) = lower(_assigned_email)
      AND lower(vacation_substitute_email) = lower(auth.email())
  )
$$;

-- Drop and recreate the issues SELECT policy to include substitutes
DROP POLICY IF EXISTS "Users can view assigned issues" ON public.issues;
CREATE POLICY "Users can view assigned issues"
ON public.issues
FOR SELECT
USING (
  lower(assigned_email) = lower(auth.email())
  OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
  OR is_vacation_substitute(assigned_email)
);

-- Drop and recreate the issues UPDATE policy to include substitutes
DROP POLICY IF EXISTS "Users can update assigned issues" ON public.issues;
CREATE POLICY "Users can update assigned issues"
ON public.issues
FOR UPDATE
USING (
  lower(assigned_email) = lower(auth.email())
  OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
  OR is_vacation_substitute(assigned_email)
);

-- Update comments SELECT policy to include substitutes
DROP POLICY IF EXISTS "Users can view comments on assigned issues" ON public.comments;
CREATE POLICY "Users can view comments on assigned issues"
ON public.comments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = comments.issue_id
      AND (
        lower(issues.assigned_email) = lower(auth.email())
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
        OR is_vacation_substitute(issues.assigned_email)
      )
  )
);

-- Update comments INSERT policy to include substitutes
DROP POLICY IF EXISTS "Users can add comments on assigned issues" ON public.comments;
CREATE POLICY "Users can add comments on assigned issues"
ON public.comments
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = comments.issue_id
      AND (
        lower(issues.assigned_email) = lower(auth.email())
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
        OR is_vacation_substitute(issues.assigned_email)
      )
  )
);

-- Update issue_status_updates SELECT policy to include substitutes
DROP POLICY IF EXISTS "Users can view status updates" ON public.issue_status_updates;
CREATE POLICY "Users can view status updates"
ON public.issue_status_updates
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['admin'::app_role, 'ops_lead'::app_role, 'team_lead'::app_role])
  OR updated_by = auth.uid()
  OR (issue_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = issue_status_updates.issue_id
      AND (
        lower(issues.assigned_email) = lower(auth.email())
        OR is_vacation_substitute(issues.assigned_email)
      )
  ))
);
