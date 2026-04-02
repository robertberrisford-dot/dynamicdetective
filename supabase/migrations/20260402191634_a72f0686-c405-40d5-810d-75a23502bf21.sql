
CREATE TABLE public.sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  function_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  message TEXT,
  details JSONB,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage sync_logs"
ON public.sync_logs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert sync_logs"
ON public.sync_logs
FOR INSERT
WITH CHECK (true);
