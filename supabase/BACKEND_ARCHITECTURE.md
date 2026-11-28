# Power Gym Studio v4.0 — Relational Database, Auth & Sub-Store Architecture

## 1. Authentication & Protected Routes (`js/auth.js`)
- **Supabase Auth (`@supabase/supabase-js` v2.49.4)**: Supports **Google Sign-In (`signInWithOAuth`)** and Email/Password authentication.
- **Protected Dashboard (`index.html`)**: Locked behind `#pgAuthGate` (`html.pg-auth-locked`) until a valid session and active `pg_gym_memberships` record (`owner`, `captain`, or `supervisor`) are verified.
- **Bootstrap & Staff Invites**:
  - First user signing in claims `owner` role on `powergym-main` via `public.pg_claim_or_join_gym`.
  - Additional captains and supervisors join via single-use `pg_gym_invites` links (`?pgInvite=inv_...`).
- **Public Sub-Store (`store.html` + `store.js`)**: Publicly browsable with optional Google Sign-In for players to auto-fill details and view their own reservation history (`store_my_reservations`).

## 2. Normalized PostgreSQL Schema (`supabase/migrations/20261128020000_power_gym_complete.sql`)
- **Core & RBAC**: `pg_gyms`, `pg_gym_memberships`, `pg_gym_invites`, plus `private.user_gym_role`, `private.has_gym_access`, and `private.is_gym_manager`.
- **Operations & Members**: `pg_members` (with soft-delete `deleted_at`), `pg_member_freezes`, `pg_attendance_logs`, `pg_trainers`, `pg_gym_status_reports`, `pg_whatsapp_logs`, `pg_audit_logs`.
- **Finance & Accounting**: `pg_finance_transactions`, `pg_debt_entries`, `pg_debt_payments`, `pg_subscription_renewals`, `pg_receipts`, `pg_daily_closes`, `pg_accounting_archives`.
- **Inventory & Sub-Store**: `pg_inventory_items`, `pg_sales_orders`, `store_settings`, `store_products`, `store_reservations` (atomic stock deduction & profit logging on `delivered` status).
