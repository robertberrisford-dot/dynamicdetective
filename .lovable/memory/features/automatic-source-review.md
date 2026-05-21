---
name: Automatic Source Review check
description: Flags vouchers with source=automatic that started yesterday; runs on main + iGraal sheets per country and persists until resolved/wont_fix
type: feature
---
- Issue type: `automatic_source_review` (severity: warning)
- Trigger: active voucher with `voucher_source == "automatic"` AND start date == yesterday (UTC).
- Start date source: prefer `voucher_started_at` (AE), fall back to `voucher_automatic_extension_type` (AF). UK sheet stores booleans in AE and the real ISO timestamp in AF, so the fallback is required for UK.
- Domains tracked separately via the `sheet_name` column:
  - Main: existing main voucher sheet name
  - iGraal: `country_configs.igraal_voucher_sheet_name` (DE + PL)
  - UK: only main sheet
- sync-reconcile now collects distinct (sheet_id, sheet_name) pairs from incoming issues so it can fetch/delete/insert across both sheets in one run.
- IssueDetail shows a "Voucher" group (title, code, captions, T&Cs, source, start date) and an "Open in Admin" link using `https://ap.cuponation.com/country/{country}/admin/clients/b375850ebe3345b1a43e6d730ca545b5/vouchers?origin=imt&voucher-manage={voucher_id_pool}`.
- iGraal cashback combinable: tries common header names (`is_cashback_combinable` etc.), falls back to column AH (index 33); value is appended to `voucher_description` ("Cashback combinable: yes/no/unknown").
