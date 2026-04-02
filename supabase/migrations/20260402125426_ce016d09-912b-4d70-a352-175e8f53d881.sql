
-- Create editors table
CREATE TABLE public.editors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(email)
);

-- Enable RLS
ALTER TABLE public.editors ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view editors
CREATE POLICY "Authenticated users can view editors"
  ON public.editors FOR SELECT
  TO authenticated
  USING (true);

-- Admins can manage editors
CREATE POLICY "Admins can manage editors"
  ON public.editors FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_editors_updated_at
  BEFORE UPDATE ON public.editors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
