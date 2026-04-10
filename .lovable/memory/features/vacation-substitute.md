---
name: Vacation substitute system
description: Editors can have a vacation substitute assigned who sees and can edit their issues
type: feature
---
- `editors.vacation_substitute_email` column stores the substitute's email
- DB function `is_vacation_substitute()` checks if current user substitutes for a given editor
- RLS policies on issues, comments, issue_status_updates allow substitutes full access
- `manage-user-role` edge function handles `set_vacation_sub` action
- Dashboard shows a green banner with profile switcher when user is a substitute
- One person can substitute for multiple editors simultaneously
