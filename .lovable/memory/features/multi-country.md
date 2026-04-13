---
name: Multi-country support
description: country_configs table stores per-country sheet IDs, sync scoped by country, dashboard selector for leads
type: feature
---
- `country_configs` table: country_code, label, voucher_spreadsheet_id, voucher_sheet_name, editors_sheet_name, team_lead_email, enabled
- `editors.country` column: associates editors with a country (default 'de')
- `issues.country` column: already existed, now populated by sync
- `retailers.country` column: already existed, scoped by country in sync
- Sync function accepts `country_code` param, scopes retailer lookup and issue deletion by country
- Scheduled sync iterates all enabled countries
- Dashboard: CountrySelector component shown to team leads and ops leads
- EditorsList, DomainOverview, Analytics all accept `country` prop for filtering
- DE: Sheet 1bml..., tab "MYDEAL_DE_API_Vouchers (Preset)"
- PL: Sheet 1ULEHlFn..., tab "Pepper - Voucher(Preset)", editors tab "editors"
