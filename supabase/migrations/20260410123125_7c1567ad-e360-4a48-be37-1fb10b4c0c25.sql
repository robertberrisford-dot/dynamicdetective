
-- Add vacation_substitute_email column to editors table
-- When set, it means this editor is on vacation and the named substitute covers for them
ALTER TABLE public.editors 
ADD COLUMN vacation_substitute_email text DEFAULT NULL;
