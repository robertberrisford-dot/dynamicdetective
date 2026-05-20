# Project Memory

## Core
Website audit issue tracker. DM Sans font, blue primary (230 70% 52%).
Magic link auth. Issues synced from Google Sheets via edge function.
Users see only issues assigned to their email. Admins see all.
Roles stored in user_roles table (app_role enum: admin/user/team_lead/ops_lead).
Multi-country support: country_configs table, country selector for ops/team leads.

## Memories
- [Schema design](mem://features/schema) — Issues, comments, status updates tables with RLS
- [Google Sheets sync](mem://features/sheets-sync) — Edge function maps sheet columns to DB, requires GOOGLE_SERVICE_ACCOUNT_KEY
- [Vacation substitute](mem://features/vacation-substitute) — Editors can cover for colleagues on vacation
- [Multi-country](mem://features/multi-country) — country_configs table drives sync per country (DE, PL), country selector for leads
- [Not Allowed status](mem://features/not-allowed-status) — Status for missing-code issues, hides from active views, preserved across syncs
