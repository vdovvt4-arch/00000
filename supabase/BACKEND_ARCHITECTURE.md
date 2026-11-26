# Power Gym Backend & Data Architecture (v3.0.0)

## 1. Frontend Data Foundation (`js/data-foundation.js`)
- **Schema Version `3.0.0`**: Automatic boot-time normalization and deduplication across `power_gym_players_v1`, `pg_inventory_v1`, `pg_sales_v1`, and `power_gym_finance_ledger_v2`.
- **Integrity Diagnostics**: `PGDataFoundation.validateAll()` checks entity integrity, missing phone numbers, and low-stock items.

## 2. Backend Service Facade (`js/backend-api.js`)
- Exposed via `window.PGBackend`:
  - `PGBackend.health()`
  - `PGBackend.members.list() / getById(id) / upsert(member)`
  - `PGBackend.inventory.list() / lowStock() / upsert(item)`
  - `PGBackend.sales.list() / totalRevenue() / totalProfit()`
  - `PGBackend.sync.now() / pushStructuredSnapshot()`

## 3. Supabase Relational Backend (`supabase/backend-schema.sql` & `supabase/backend-rpc.sql`)
- Normalized PostgreSQL tables (`pg_gyms`, `pg_members`, `pg_inventory_items`, `pg_sales_orders`, `pg_attendance_logs`) with composite primary keys, indexes, and strict RLS (`anon` direct table access revoked; all mutations pass through `SECURITY DEFINER` RPCs verified against `gym_access`).
