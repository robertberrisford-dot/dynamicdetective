
-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user has a role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Create issues table
CREATE TABLE public.issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id TEXT,
  retailer_pool_id TEXT,
  client_name TEXT,
  merchant_quality TEXT,
  published TEXT,
  indexed TEXT,
  active_vouchers TEXT,
  active_codes TEXT,
  active_deals TEXT,
  affiliate_network TEXT,
  seo_url TEXT,
  retailer_seo_title TEXT,
  retailer_seo_desc TEXT,
  h1 TEXT,
  logo_alt_text TEXT,
  show_expired_vouchers TEXT,
  last_verified TEXT,
  ranking_algorithm TEXT,
  retailer_url_anchor TEXT,
  retailer_url TEXT,
  page_title TEXT,
  url_anchor_js_link TEXT,
  country TEXT,
  keyword_1 TEXT,
  keyword_2 TEXT,
  keyword_3 TEXT,
  keyword_4 TEXT,
  assigned_email TEXT,
  retailer_assignment TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  sheet_id TEXT,
  sheet_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

-- Issues RLS
CREATE POLICY "Users can view assigned issues"
  ON public.issues FOR SELECT
  USING (
    lower(assigned_email) = lower(auth.email())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Users can update assigned issues"
  ON public.issues FOR UPDATE
  USING (
    lower(assigned_email) = lower(auth.email())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins can insert issues"
  ON public.issues FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can insert issues"
  ON public.issues FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can delete issues"
  ON public.issues FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- Create comments table
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES public.issues(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_email TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments on assigned issues"
  ON public.comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.issues
      WHERE issues.id = comments.issue_id
      AND (lower(issues.assigned_email) = lower(auth.email()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Users can add comments on assigned issues"
  ON public.comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.issues
      WHERE issues.id = comments.issue_id
      AND (lower(issues.assigned_email) = lower(auth.email()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Create issue_status_updates table
CREATE TABLE public.issue_status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES public.issues(id) ON DELETE CASCADE NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.issue_status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view status updates on assigned issues"
  ON public.issue_status_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.issues
      WHERE issues.id = issue_status_updates.issue_id
      AND (lower(issues.assigned_email) = lower(auth.email()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Users can add status updates on assigned issues"
  ON public.issue_status_updates FOR INSERT
  WITH CHECK (
    auth.uid() = updated_by
    AND EXISTS (
      SELECT 1 FROM public.issues
      WHERE issues.id = issue_status_updates.issue_id
      AND (lower(issues.assigned_email) = lower(auth.email()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_issues_assigned_email ON public.issues(assigned_email);
CREATE INDEX idx_issues_status ON public.issues(status);
CREATE INDEX idx_issues_country ON public.issues(country);
CREATE INDEX idx_comments_issue_id ON public.comments(issue_id);
CREATE INDEX idx_status_updates_issue_id ON public.issue_status_updates(issue_id);
