## Website Audit Issue Tracker

### 1. Enable Lovable Cloud
- Database, auth, and edge functions

### 2. Database Schema
- `issues` table: stores synced sheet data (retailer_id, pool_id, client_name, merchant_quality, published, indexed, active_vouchers, active_codes, active_deals, affiliate_network, seo_url, seo_title, seo_desc, h1, logo_alt, show_expired, last_verified, ranking_algorithm, retailer_url_anchor, retailer_url, page_title, url_anchor_js, country, keyword_1-4, assigned_email, status)
- `comments` table: user comments on issues
- `issue_status_updates` table: status change history
- RLS: users only see issues assigned to their email

### 3. Authentication
- Magic link (passwordless) login via email

### 4. Edge Function: Google Sheets Sync
- Edge function that reads from Google Sheets API using a service account key
- Syncs/upserts rows into `issues` table
- Triggered manually from an admin action

### 5. Frontend
- Login page with magic link
- Dashboard showing issues assigned to the logged-in user's email
- Issue detail view with status updates and comments
- Filters by country, merchant quality, status
- Admin page to trigger sheet sync

### 6. Secrets Needed
- `GOOGLE_SERVICE_ACCOUNT_KEY` for Sheets API access