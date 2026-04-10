# Project Memory

## Core
Website audit issue tracker. DM Sans font, blue primary (230 70% 52%).
Magic link auth. Issues synced from Google Sheets via edge function.
Users see only issues assigned to their email. Admins see all.
Roles stored in user_roles table (app_role enum: admin/user/team_lead/ops_lead).
abc_repeated_tnc excluded from warning counts in overview.

## Memories
- [Schema design](mem://features/schema) — Issues, comments, status updates tables with RLS
- [Google Sheets sync](mem://features/sheets-sync) — Edge function maps sheet columns to DB, requires GOOGLE_SERVICE_ACCOUNT_KEY
- [Severity classification](mem://features/severity-classification) — Check types classified as issues vs warnings
- [Vacation substitute](mem://features/vacation-substitute) — Editors can have a vacation sub who sees/edits their issues
