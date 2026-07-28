---
name: Low-engagement landing page check
description: Flags dead vouchers on pages where >40% of vouchers have CPD<=0 (7d); CPD from column AK voucher_rank_cpd
type: feature
---
- Issue type: `low_engagement_page` (severity: warning). DE enabled by default; PL/UK disabled.
- Source column: AK (`voucher_rank_cpd`) in main voucher sheet. Sync stores as transient `_cpd_7d` (stripped before insert). Fallback to raw index 36 if header renamed.
- Trigger per retailer landing page (grouped by `retailer_pool_id`):
  - `>= 5` active vouchers on the page
  - `> 40%` of them have parseable CPD `<= 0.0` (zero engagement)
- Emits one issue per dead voucher with description `[Code|Deal] Low engagement: X/Y (Z%) on {client_name} have zero CPD (7d). This voucher CPD: N.NN.`
- Added to `syncManagedTypes` in sync-reconcile so it is deleted/re-inserted normally.
