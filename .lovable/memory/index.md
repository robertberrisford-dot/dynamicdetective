# Project Memory

## Core
Website audit issue tracker. DM Sans font, blue primary (230 70% 52%).
Magic link auth. Issues synced from Google Sheets via edge function.
Users see only issues assigned to their email. Admins see all.
Roles stored in user_roles table (app_role enum: admin/user).
Issue-card visibility changes must always apply to EditorIssues AND DomainOverview (team+domain scopes).

## Memories
- [Schema design](mem://features/schema) — Issues, comments, status updates tables with RLS
- [Google Sheets sync](mem://features/sheets-sync) — Edge function maps sheet columns to DB, requires GOOGLE_SERVICE_ACCOUNT_KEY
- [Visibility changes all views](mem://preferences/visibility-changes-all-views) — Mirror issue-card rendering edits across EditorIssues and DomainOverview
- [Automatic Source Review](mem://features/automatic-source-review) — voucher_source=automatic + started yesterday, runs on main + iGraal, persists until resolved
