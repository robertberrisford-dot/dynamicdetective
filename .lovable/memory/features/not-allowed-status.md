---
name: Not Allowed status
description: Status for code_missing_on_main / code_missing_on_igraal — voucher cannot be added to other domain, hides issue from active views
type: feature
---
- Status value: `not_allowed`
- Only selectable when issue_type is `code_missing_on_igraal` or `code_missing_on_main`
- Excluded from active queries alongside `resolved` and `wont_fix` (EditorIssues, DomainOverview, EditorsList counts)
- Reviewable in WontFixIssues (REVIEWABLE_STATUSES)
- sync-reconcile preserves it across syncs (status != 'open' branch) and counts it as resolved in analytics snapshots
- Status configs added to EditorIssues, DomainOverview, IssueDetail, Analytics, WontFixIssues
