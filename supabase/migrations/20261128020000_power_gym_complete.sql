-- =====================================================================================
-- Power Gym Studio v4.0 — Complete Normalized Relational Schema, Sub-Store, Auth & RLS
-- Project: bpwjdjkqcfxerizrssbs
-- Follows Supabase & PostgreSQL Best Practices:
--   * Explicit RLS on every table + explicit GRANTs
--   * Private schema SECURITY DEFINER helpers with (select auth.uid()) caching
--   * Normalized tables for Gym + Finance + Receipts + Attendance + Sub-Store
--   * Automatic lossless migration from legacy public.gym_sync JSON blobs
--   * Revocation of leaked legacy syncSecret / anon table access
-- =====================================================================================

begin;

create extension if not exists pgcrypto;
create schema if not exists private;

-- =====================================================================================
-- 0. Safe Casting Helpers (in private schema)
-- =====================================================================================
create or replace function private.safe_date(p_val text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_val is null or length(trim(p_val)) < 10 then
    return null;
  end if;
  if trim(p_val) ~ '^\d{4}-\d{2}-\d{2}' then
    return substring(trim(p_val) from 1 for 10)::date;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.safe_timestamptz(p_val text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_val is null or trim(p_val) = '' then
    return now();
  end if;
  return trim(p_val)::timestamptz;
exception when others then
  return now();
end;
$$;

create or replace function private.safe_num(p_val text, p_default numeric default 0)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
begin
  if p_val is null then
    return p_default;
  end if;
  v_clean := regexp_replace(trim(p_val), '[^0-9.-]', '', 'g');
  if v_clean = '' or v_clean = '-' or v_clean = '.' then
    return p_default;
  end if;
  return v_clean::numeric;
exception when others then
  return p_default;
end;
$$;

-- =====================================================================================
-- 1. Core Gym & Multi-User Auth Membership Tables
-- =====================================================================================
create table if not exists public.pg_gyms (
  gym_id text primary key,
  gym_name text not null default 'Power Gym | بور جم',
  branch text not null default 'كربلاء - الحر - قرب فلكة الثورة',
  supervisor_name text not null default '',
  receipt_stamp text not null default '',
  default_prices jsonb not null default '{"0.5":15000,"1":25000,"2":45000,"3":65000,"6":120000,"12":220000}'::jsonb,
  crowd_iron text not null default 'medium',
  crowd_cardio text not null default 'low',
  crowd_updated_at timestamptz,
  ops_settings jsonb not null default '{}'::jsonb,
  wa_templates jsonb not null default '{}'::jsonb,
  receipt_settings jsonb not null default '{}'::jsonb,
  manual_profit_adjustment numeric(12,2) not null default 0,
  manual_debt_adjustment numeric(12,2) not null default 0,
  receipt_counter integer not null default 0,
  schema_version integer not null default 4,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pg_gyms add column if not exists supervisor_name text not null default '';
alter table public.pg_gyms add column if not exists receipt_stamp text not null default '';
alter table public.pg_gyms add column if not exists default_prices jsonb not null default '{"0.5":15000,"1":25000,"2":45000,"3":65000,"6":120000,"12":220000}'::jsonb;
alter table public.pg_gyms add column if not exists crowd_iron text not null default 'medium';
alter table public.pg_gyms add column if not exists crowd_cardio text not null default 'low';
alter table public.pg_gyms add column if not exists crowd_updated_at timestamptz;
alter table public.pg_gyms add column if not exists ops_settings jsonb not null default '{}'::jsonb;
alter table public.pg_gyms add column if not exists wa_templates jsonb not null default '{}'::jsonb;
alter table public.pg_gyms add column if not exists receipt_settings jsonb not null default '{}'::jsonb;
alter table public.pg_gyms add column if not exists manual_profit_adjustment numeric(12,2) not null default 0;
alter table public.pg_gyms add column if not exists manual_debt_adjustment numeric(12,2) not null default 0;
alter table public.pg_gyms add column if not exists receipt_counter integer not null default 0;

create table if not exists public.pg_gym_memberships (
  id bigint generated always as identity primary key,
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  avatar_url text not null default '',
  role text not null default 'supervisor' check (role in ('owner', 'captain', 'supervisor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, user_id)
);

create index if not exists idx_pg_gym_memberships_user on public.pg_gym_memberships (user_id) where is_active = true;
create index if not exists idx_pg_gym_memberships_gym_role on public.pg_gym_memberships (gym_id, role) where is_active = true;

create table if not exists public.pg_gym_invites (
  token text primary key,
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  role text not null default 'supervisor' check (role in ('captain', 'supervisor')),
  label text not null default 'مشرف',
  created_by uuid references auth.users(id) on delete set null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_pg_gym_invites_gym on public.pg_gym_invites (gym_id);

-- =====================================================================================
-- 2. Private Security Helper Functions for Fast RLS
-- =====================================================================================
create or replace function private.user_gym_role(p_gym_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.pg_gym_memberships m
  where m.gym_id = p_gym_id
    and m.user_id = (select auth.uid())
    and m.is_active = true
  limit 1;
$$;

create or replace function private.has_gym_access(p_gym_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_gym_role(p_gym_id) in ('owner', 'captain', 'supervisor'), false);
$$;

create or replace function private.is_gym_manager(p_gym_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_gym_role(p_gym_id) in ('owner', 'captain'), false);
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- =====================================================================================
-- 3. Normalized Gym Operational & Financial Tables
-- =====================================================================================

-- 3.1 Members (Players)
create table if not exists public.pg_members (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  code text not null default '',
  name text not null,
  age smallint not null default 20,
  phone text not null default '',
  intl_phone text not null default '',
  plan_type text not null default 'حديد عام (كمال أجسام)',
  duration_months numeric(4,2) not null default 1,
  start_date date not null default current_date,
  end_date date not null default (current_date + 30),
  paid_amount numeric(12,2) not null default 0,
  debt_amount numeric(12,2) not null default 0,
  notes text not null default '',
  course_notes text not null default '',
  course_images jsonb not null default '[]'::jsonb,
  attendance_count integer not null default 0,
  last_check_in date,
  photo text not null default '',
  telegram_file_id text not null default '',
  player_chat_id text not null default '',
  activation_sent boolean not null default false,
  three_day_reminders_sent jsonb not null default '[]'::jsonb,
  last_reminder_date date,
  coach_submission_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

alter table public.pg_members add column if not exists age smallint not null default 20;
alter table public.pg_members add column if not exists intl_phone text not null default '';
alter table public.pg_members add column if not exists notes text not null default '';
alter table public.pg_members add column if not exists course_notes text not null default '';
alter table public.pg_members add column if not exists course_images jsonb not null default '[]'::jsonb;
alter table public.pg_members add column if not exists attendance_count integer not null default 0;
alter table public.pg_members add column if not exists last_check_in date;
alter table public.pg_members add column if not exists photo text not null default '';
alter table public.pg_members add column if not exists telegram_file_id text not null default '';
alter table public.pg_members add column if not exists player_chat_id text not null default '';
alter table public.pg_members add column if not exists activation_sent boolean not null default false;
alter table public.pg_members add column if not exists three_day_reminders_sent jsonb not null default '[]'::jsonb;
alter table public.pg_members add column if not exists last_reminder_date date;
alter table public.pg_members add column if not exists coach_submission_id text not null default '';
alter table public.pg_members add column if not exists deleted_at timestamptz;

create index if not exists idx_pg_members_active_end on public.pg_members (gym_id, end_date) where deleted_at is null;
create index if not exists idx_pg_members_active_code on public.pg_members (gym_id, code) where deleted_at is null;
create index if not exists idx_pg_members_updated on public.pg_members (gym_id, updated_at desc);

-- 3.2 Subscription Freezes
create table if not exists public.pg_member_freezes (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  member_id text not null,
  member_name text not null default '',
  start_date date not null default current_date,
  ended_at date,
  added_days integer not null default 0,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_freezes_active on public.pg_member_freezes (gym_id, member_id) where ended_at is null;

-- 3.3 Attendance Logs
create table if not exists public.pg_attendance_logs (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  member_id text not null,
  member_code text not null default '',
  member_name text not null default '',
  check_in_date date not null default current_date,
  check_in_time text not null default '',
  check_type text not null default 'in',
  check_in_at timestamptz not null default now(),
  primary key (gym_id, id)
);

alter table public.pg_attendance_logs add column if not exists member_code text not null default '';
alter table public.pg_attendance_logs add column if not exists check_in_time text not null default '';
alter table public.pg_attendance_logs add column if not exists check_type text not null default 'in';

create index if not exists idx_pg_attendance_gym_date on public.pg_attendance_logs (gym_id, check_in_date desc);
create index if not exists idx_pg_attendance_member on public.pg_attendance_logs (gym_id, member_id, check_in_date desc);

-- 3.4 Finance Transactions (Income & Expenses)
create table if not exists public.pg_finance_transactions (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  tx_type text not null default 'income' check (tx_type in ('income', 'expense')),
  category text not null default '',
  title text not null,
  description text not null default '',
  amount numeric(12,2) not null default 0,
  tx_date date not null default current_date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_fin_tx_date on public.pg_finance_transactions (gym_id, tx_date desc) where deleted_at is null;

-- 3.5 Itemized Debt Entries & Debt Payments
create table if not exists public.pg_debt_entries (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  member_id text not null,
  description text not null,
  amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  entry_date date not null default current_date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_debt_entries_member on public.pg_debt_entries (gym_id, member_id, entry_date desc);

create table if not exists public.pg_debt_payments (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  member_id text not null,
  title text not null default '',
  amount numeric(12,2) not null default 0,
  payment_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_debt_payments_date on public.pg_debt_payments (gym_id, payment_date desc);

-- 3.6 Subscription Renewals
create table if not exists public.pg_subscription_renewals (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  member_id text not null,
  member_name text not null default '',
  start_date date not null,
  end_date date not null,
  duration_months numeric(4,2) not null default 1,
  paid_amount numeric(12,2) not null default 0,
  renewal_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_renewals_date on public.pg_subscription_renewals (gym_id, renewal_date desc);

-- 3.7 Official Receipts
create table if not exists public.pg_receipts (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  serial integer not null default 1,
  receipt_no text not null,
  receipt_type text not null default 'subscription',
  receipt_date date not null default current_date,
  receipt_time text not null default '',
  member_id text not null default '',
  member_name text not null default 'زبون',
  member_code text not null default '',
  member_phone text not null default '',
  description text not null default '',
  start_date date,
  end_date date,
  duration_months numeric(4,2) not null default 0,
  list_price numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  remaining numeric(12,2) not null default 0,
  member_debt_after numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  cashier text not null default '',
  tx_id text not null default '',
  print_count integer not null default 0,
  voided boolean not null default false,
  void_reason text not null default '',
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_receipts_date on public.pg_receipts (gym_id, receipt_date desc, serial desc);

-- 3.8 Inventory Items & POS/Store Sales Orders
create table if not exists public.pg_inventory_items (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  name text not null,
  category text not null default 'مكملات',
  sku text not null default '',
  qty integer not null default 0,
  min_qty integer not null default 3,
  cost numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,
  store_product_id text not null default '',
  show_in_store boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

alter table public.pg_inventory_items add column if not exists store_product_id text not null default '';
alter table public.pg_inventory_items add column if not exists deleted_at timestamptz;
alter table public.pg_inventory_items add column if not exists created_at timestamptz not null default now();

create index if not exists idx_pg_inventory_active on public.pg_inventory_items (gym_id, category) where deleted_at is null;

create table if not exists public.pg_sales_orders (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  item_id text not null default '',
  item_name text not null,
  category text not null default 'عام',
  qty integer not null default 1,
  unit_price numeric(12,2) not null default 0,
  unit_cost numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  profit numeric(12,2) not null default 0,
  source text not null default 'pos',
  sale_date date not null default current_date,
  sale_time text not null default '',
  reservation_id text not null default '',
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

alter table public.pg_sales_orders add column if not exists sale_time text not null default '';
alter table public.pg_sales_orders add column if not exists reservation_id text not null default '';

create index if not exists idx_pg_sales_gym_date on public.pg_sales_orders (gym_id, sale_date desc);

-- 3.9 Trainers, Daily Closes, Accounting Archives, Status Reports, WhatsApp & Audit Logs
create table if not exists public.pg_trainers (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  name text not null,
  phone text not null default '',
  role text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create table if not exists public.pg_daily_closes (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  close_date date not null default current_date,
  close_time text not null default '',
  net_expected numeric(12,2) not null default 0,
  actual_cash numeric(12,2) not null default 0,
  difference numeric(12,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create table if not exists public.pg_accounting_archives (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  label text not null,
  net_profit numeric(12,2) not null default 0,
  total_income numeric(12,2) not null default 0,
  total_expense numeric(12,2) not null default 0,
  archive_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create table if not exists public.pg_gym_status_reports (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  reported_by text not null default '',
  iron_status text not null default 'medium',
  cardio_status text not null default 'low',
  condition text not null default '',
  note text not null default '',
  report_date date not null default current_date,
  report_time text not null default '',
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create table if not exists public.pg_whatsapp_logs (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  log_key text not null,
  sent_date date not null default current_date,
  sent_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (gym_id, log_key)
);

create table if not exists public.pg_audit_logs (
  id bigint generated always as identity primary key,
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  client_id text not null default '',
  time_label text not null default '',
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pg_audit_gym_created on public.pg_audit_logs (gym_id, created_at desc);

-- =====================================================================================
-- 4. Sub-Store ("متجر القاعة") Normalized Tables
-- =====================================================================================
create table if not exists public.store_settings (
  gym_id text primary key references public.pg_gyms(gym_id) on delete cascade,
  store_name text not null default 'متجر Power Gym',
  whatsapp text not null default '',
  top_note text not null default 'توصيل واستلام مباشر من داخل القاعة',
  working_hours text not null default '',
  currency text not null default 'د.ع',
  theme_bg text not null default 'dark',
  brand_color text not null default '#f59e0b',
  is_open boolean not null default true,
  show_sold_out boolean not null default true,
  allow_customer_note boolean not null default true,
  categories jsonb not null default '["بروتينات","كرياتين وطاقة","مشروبات","ملابس وإكسسوارات"]'::jsonb,
  promo_enabled boolean not null default true,
  promo_speed_sec smallint not null default 4,
  promos jsonb not null default '[]'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_settings add column if not exists store_name text not null default 'متجر Power Gym';
alter table public.store_settings add column if not exists whatsapp text not null default '';
alter table public.store_settings add column if not exists top_note text not null default 'توصيل واستلام مباشر من داخل القاعة';
alter table public.store_settings add column if not exists working_hours text not null default '';
alter table public.store_settings add column if not exists currency text not null default 'د.ع';
alter table public.store_settings add column if not exists theme_bg text not null default 'dark';
alter table public.store_settings add column if not exists brand_color text not null default '#f59e0b';
alter table public.store_settings add column if not exists is_open boolean not null default true;
alter table public.store_settings add column if not exists show_sold_out boolean not null default true;
alter table public.store_settings add column if not exists allow_customer_note boolean not null default true;
alter table public.store_settings add column if not exists categories jsonb not null default '["بروتينات","كرياتين وطاقة","مشروبات","ملابس وإكسسوارات"]'::jsonb;
alter table public.store_settings add column if not exists promo_enabled boolean not null default true;
alter table public.store_settings add column if not exists promo_speed_sec smallint not null default 4;
alter table public.store_settings add column if not exists promos jsonb not null default '[]'::jsonb;
alter table public.store_settings add column if not exists note text not null default '';
alter table public.store_settings add column if not exists updated_at timestamptz not null default now();

create table if not exists public.store_products (
  id text not null,
  gym_id text not null default 'powergym-main',
  inventory_item_id text not null default '',
  name text not null,
  categories jsonb not null default '[]'::jsonb,
  description text not null default '',
  price numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  image text not null default '',
  available boolean not null default true,
  stock_qty integer not null default 10,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

alter table public.store_products add column if not exists inventory_item_id text not null default '';
alter table public.store_products add column if not exists categories jsonb not null default '[]'::jsonb;
alter table public.store_products add column if not exists description text not null default '';
alter table public.store_products add column if not exists discount_percent numeric(5,2) not null default 0;
alter table public.store_products add column if not exists image text not null default '';
alter table public.store_products add column if not exists available boolean not null default true;
alter table public.store_products add column if not exists stock_qty integer not null default 10;
alter table public.store_products add column if not exists sort_order integer not null default 0;
alter table public.store_products add column if not exists created_at timestamptz not null default now();
alter table public.store_products add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_store_products_gym_id_id on public.store_products (gym_id, id);
create index if not exists idx_store_products_gym_sort on public.store_products (gym_id, sort_order asc, updated_at desc);

create table if not exists public.store_reservations (
  id text primary key default ('res_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 1, 6)),
  gym_id text not null default 'powergym-main',
  product_id text not null,
  product_name text not null,
  unit_price numeric(12,2) not null default 0,
  qty integer not null default 1 check (qty between 1 and 50),
  total_price numeric(12,2) not null default 0,
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_email text not null default '',
  customer_name text not null,
  customer_phone text not null,
  note text not null default '',
  status text not null default 'new' check (status in ('new', 'contacted', 'delivered', 'cancelled')),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_reservations add column if not exists unit_price numeric(12,2) not null default 0;
alter table public.store_reservations add column if not exists total_price numeric(12,2) not null default 0;
alter table public.store_reservations add column if not exists customer_user_id uuid references auth.users(id) on delete set null;
alter table public.store_reservations add column if not exists customer_email text not null default '';
alter table public.store_reservations add column if not exists note text not null default '';
alter table public.store_reservations add column if not exists status text not null default 'new';
alter table public.store_reservations add column if not exists delivered_at timestamptz;
alter table public.store_reservations add column if not exists updated_at timestamptz not null default now();

-- Ensure id default exists and relax any legacy NOT NULL columns (e.g. pin_hash) on store_* tables
do $$
declare
  col record;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'store_reservations'
      and column_name = 'id' and data_type = 'text' and column_default is null
  ) then
    alter table public.store_reservations
      alter column id set default ('res_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 1, 6));
  end if;

  for col in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('store_settings', 'store_products', 'store_reservations')
      and is_nullable = 'NO'
      and column_default is null
      and column_name not in ('id', 'gym_id', 'name', 'product_id', 'product_name', 'customer_name', 'customer_phone')
  loop
    execute format('alter table public.%I alter column %I drop not null', col.table_name, col.column_name);
  end loop;
end;
$$;

create index if not exists idx_store_reservations_gym_status on public.store_reservations (gym_id, status, created_at desc);
create index if not exists idx_store_reservations_customer_uid on public.store_reservations (customer_user_id, created_at desc) where customer_user_id is not null;

-- =====================================================================================
-- 5. Lossless Automatic Migration from Legacy public.gym_sync (47 Players + Receipts + Inventory)
--    AND Lockdown of Legacy Leaked Secret
-- =====================================================================================
insert into public.pg_gyms (gym_id, gym_name, branch)
values ('powergym-main', 'Power Gym | بور جم', 'كربلاء - الحر - قرب فلكة الثورة')
on conflict (gym_id) do nothing;

insert into public.store_settings (gym_id, store_name)
values ('powergym-main', 'متجر Power Gym')
on conflict (gym_id) do nothing;

do $$
declare
  v_players jsonb := '[]'::jsonb;
  v_profile jsonb := '{}'::jsonb;
  v_ledger jsonb := '{}'::jsonb;
  v_freezes jsonb := '[]'::jsonb;
  v_inv jsonb := '[]'::jsonb;
  v_sales jsonb := '[]'::jsonb;
  v_trainers jsonb := '[]'::jsonb;
  v_crowd jsonb := '{}'::jsonb;
  v_wa_sent jsonb := '{}'::jsonb;
  v_wa_tpl jsonb := '{}'::jsonb;
  v_ops jsonb := '{}'::jsonb;
  v_audit jsonb := '[]'::jsonb;
  r record;
begin
  if to_regclass('public.gym_sync') is not null then
    for r in
      select storage_key, payload
      from public.gym_sync
      where gym_id = 'powergym-main'
    loop
      begin
        case r.storage_key
          when 'power_gym_players_v1' then v_players := r.payload::jsonb;
          when 'power_gym_profile_v2' then v_profile := r.payload::jsonb;
          when 'power_gym_finance_ledger_v2' then v_ledger := r.payload::jsonb;
          when 'pg_freezes_v1' then v_freezes := r.payload::jsonb;
          when 'pg_inventory_v1' then v_inv := r.payload::jsonb;
          when 'pg_sales_v1' then v_sales := r.payload::jsonb;
          when 'pg_trainers_v1' then v_trainers := r.payload::jsonb;
          when 'pg_crowd_status_v1' then v_crowd := r.payload::jsonb;
          when 'pg_whatsapp_sent_v1' then v_wa_sent := r.payload::jsonb;
          when 'pg_wa_templates_v1' then v_wa_tpl := r.payload::jsonb;
          when 'pg_ops_settings_v1' then v_ops := r.payload::jsonb;
          when 'power_gym_audit_v1' then v_audit := r.payload::jsonb;
          else null;
        end case;
      exception when others then
        null;
      end;
    end loop;

    -- 5.1 Migrate Gym Profile, Crowd, Templates & Ledger Settings
    update public.pg_gyms
    set
      gym_name = coalesce(nullif(v_profile->>'gymName', ''), gym_name),
      branch = coalesce(nullif(v_profile->>'gymBranch', ''), branch),
      supervisor_name = coalesce(v_profile->>'supervisorName', supervisor_name),
      receipt_stamp = coalesce(v_profile->>'receiptStamp', receipt_stamp),
      default_prices = case when jsonb_typeof(v_profile->'defaultPrices') = 'object' then v_profile->'defaultPrices' else default_prices end,
      crowd_iron = case when (v_crowd->>'iron') in ('low','medium','high') then v_crowd->>'iron' else crowd_iron end,
      crowd_cardio = case when (v_crowd->>'cardio') in ('low','medium','high') then v_crowd->>'cardio' else crowd_cardio end,
      crowd_updated_at = private.safe_timestamptz(v_crowd->>'updatedAt'),
      wa_templates = case when jsonb_typeof(v_wa_tpl) = 'object' then v_wa_tpl else wa_templates end,
      ops_settings = case when jsonb_typeof(v_ops) = 'object' then v_ops else ops_settings end,
      receipt_settings = case when jsonb_typeof(v_ledger->'receiptSettings') = 'object' then v_ledger->'receiptSettings' else receipt_settings end,
      manual_profit_adjustment = private.safe_num(v_ledger->>'manualProfitAdjustment', 0),
      manual_debt_adjustment = private.safe_num(v_ledger->>'manualDebtAdjustment', 0),
      receipt_counter = greatest(receipt_counter, private.safe_num(v_ledger->>'receiptCounter', 0)::int),
      updated_at = now()
    where gym_id = 'powergym-main';

    -- 5.2 Migrate Players (Members)
    if jsonb_typeof(v_players) = 'array' then
      insert into public.pg_members (
        gym_id, id, code, name, age, phone, intl_phone, plan_type, duration_months,
        start_date, end_date, paid_amount, debt_amount, notes, course_notes, course_images,
        attendance_count, last_check_in, photo, telegram_file_id, player_chat_id,
        activation_sent, three_day_reminders_sent, last_reminder_date, coach_submission_id,
        created_at, updated_at
      )
      select
        'powergym-main',
        coalesce(nullif(m->>'id', ''), 'plr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(m->>'code', ''),
        coalesce(nullif(m->>'name', ''), 'مشترك'),
        least(80, greatest(10, private.safe_num(m->>'age', 20)::int))::smallint,
        coalesce(m->>'phone', ''),
        coalesce(m->>'intlPhone', ''),
        coalesce(nullif(m->>'planType', ''), 'حديد عام (كمال أجسام)'),
        greatest(0.5, private.safe_num(m->>'durationMonths', 1)),
        coalesce(private.safe_date(m->>'startDate'), current_date),
        coalesce(private.safe_date(m->>'endDate'), current_date + 30),
        greatest(0, private.safe_num(m->>'paidAmount', 0)),
        greatest(0, private.safe_num(m->>'debtAmount', 0)),
        coalesce(m->>'notes', ''),
        coalesce(m->>'courseNotes', ''),
        case when jsonb_typeof(m->'courseImages') = 'array' then m->'courseImages' else '[]'::jsonb end,
        greatest(0, private.safe_num(m->>'attendanceCount', 0)::int),
        private.safe_date(m->>'lastCheckIn'),
        coalesce(m->>'photo', ''),
        coalesce(m->>'telegramFileId', ''),
        coalesce(m->>'playerChatId', ''),
        coalesce((m->>'activationSent')::boolean, false),
        case when jsonb_typeof(m->'threeDayRemindersSent') = 'array' then m->'threeDayRemindersSent' else '[]'::jsonb end,
        private.safe_date(m->>'lastReminderDate'),
        coalesce(m->>'coachSubmissionId', ''),
        private.safe_timestamptz(m->>'createdAt'),
        private.safe_timestamptz(m->>'updatedAt')
      from jsonb_array_elements(v_players) as m
      on conflict (gym_id, id) do update set
        code = excluded.code,
        name = excluded.name,
        phone = excluded.phone,
        intl_phone = excluded.intl_phone,
        plan_type = excluded.plan_type,
        duration_months = excluded.duration_months,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        paid_amount = excluded.paid_amount,
        debt_amount = excluded.debt_amount,
        notes = excluded.notes,
        course_notes = excluded.course_notes,
        course_images = excluded.course_images,
        attendance_count = excluded.attendance_count,
        last_check_in = excluded.last_check_in,
        photo = case when excluded.photo <> '' then excluded.photo else public.pg_members.photo end,
        updated_at = excluded.updated_at;
    end if;

    -- 5.3 Migrate Freezes
    if jsonb_typeof(v_freezes) = 'array' then
      insert into public.pg_member_freezes (
        gym_id, id, member_id, member_name, start_date, ended_at, added_days, created_by_name, updated_at
      )
      select
        'powergym-main',
        coalesce(nullif(f->>'id', ''), 'frz_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(f->>'playerId', ''),
        coalesce(f->>'name', ''),
        coalesce(private.safe_date(f->>'startDate'), current_date),
        private.safe_date(f->>'endedAt'),
        greatest(0, private.safe_num(f->>'addedDays', 0)::int),
        coalesce(f->>'by', ''),
        private.safe_timestamptz(f->>'updatedAt')
      from jsonb_array_elements(v_freezes) as f
      where coalesce(f->>'playerId', '') <> ''
      on conflict (gym_id, id) do nothing;
    end if;

    -- 5.4 Migrate Receipts, Transactions, Debts, Renewals
    if jsonb_typeof(v_ledger->'receipts') = 'array' then
      insert into public.pg_receipts (
        gym_id, id, serial, receipt_no, receipt_type, receipt_date, receipt_time,
        member_id, member_name, member_code, member_phone, description,
        start_date, end_date, duration_months, list_price, discount, subtotal,
        tax, tax_percent, total, paid, remaining, member_debt_after,
        payment_method, cashier, tx_id, voided, void_reason, created_at
      )
      select
        'powergym-main',
        coalesce(nullif(rc->>'id', ''), 'rcp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        greatest(1, private.safe_num(rc->>'serial', 1)::int),
        coalesce(nullif(rc->>'no', ''), 'PG-R-000001'),
        coalesce(nullif(rc->>'type', ''), 'subscription'),
        coalesce(private.safe_date(rc->>'date'), current_date),
        coalesce(rc->>'time', ''),
        coalesce(rc->>'playerId', ''),
        coalesce(nullif(rc->>'playerName', ''), 'زبون'),
        coalesce(rc->>'playerCode', ''),
        coalesce(rc->>'playerPhone', ''),
        coalesce(rc->>'description', ''),
        private.safe_date(rc->>'startDate'),
        private.safe_date(rc->>'endDate'),
        private.safe_num(rc->>'durationMonths', 0),
        private.safe_num(rc->>'listPrice', 0),
        private.safe_num(rc->>'discount', 0),
        private.safe_num(rc->>'subtotal', 0),
        private.safe_num(rc->>'tax', 0),
        private.safe_num(rc->>'taxPercent', 0),
        private.safe_num(rc->>'total', 0),
        private.safe_num(rc->>'paid', 0),
        private.safe_num(rc->>'remaining', 0),
        private.safe_num(rc->>'playerDebtAfter', 0),
        coalesce(nullif(rc->>'method', ''), 'cash'),
        coalesce(rc->>'cashier', ''),
        coalesce(rc->>'txId', ''),
        coalesce((rc->>'voided')::boolean, false),
        coalesce(rc->>'voidReason', ''),
        private.safe_timestamptz(rc->>'createdAt')
      from jsonb_array_elements(v_ledger->'receipts') as rc
      on conflict (gym_id, id) do nothing;
    end if;

    if jsonb_typeof(v_ledger->'transactions') = 'array' then
      insert into public.pg_finance_transactions (
        gym_id, id, tx_type, title, description, amount, tx_date, created_at
      )
      select
        'powergym-main',
        coalesce(nullif(tx->>'id', ''), 'tx_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        case when (tx->>'type') = 'expense' then 'expense' else 'income' end,
        coalesce(nullif(tx->>'title', ''), coalesce(nullif(tx->>'description', ''), 'حركة مالية')),
        coalesce(tx->>'description', ''),
        private.safe_num(tx->>'amount', 0),
        coalesce(private.safe_date(tx->>'date'), current_date),
        private.safe_timestamptz(tx->>'createdAt')
      from jsonb_array_elements(v_ledger->'transactions') as tx
      on conflict (gym_id, id) do nothing;
    end if;

    -- 5.5 Migrate Inventory & Link to Sub-Store Products
    if jsonb_typeof(v_inv) = 'array' then
      insert into public.pg_inventory_items (
        gym_id, id, name, category, qty, cost, price, store_product_id, show_in_store
      )
      select
        'powergym-main',
        coalesce(nullif(i->>'id', ''), 'itm_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(nullif(i->>'name', ''), 'منتج'),
        coalesce(nullif(i->>'category', ''), 'عام'),
        greatest(0, private.safe_num(i->>'qty', 0)::int),
        greatest(0, private.safe_num(i->>'cost', 0)),
        greatest(0, private.safe_num(i->>'price', 0)),
        case
          when coalesce(i->>'storeProductId', '') <> '' then i->>'storeProductId'
          else 'prd_' || regexp_replace(coalesce(i->>'id', ''), '^itm_', '')
        end,
        true
      from jsonb_array_elements(v_inv) as i
      on conflict (gym_id, id) do nothing;

      -- Also publish existing inventory items into store_products so the Sub-Store is immediately populated!
      insert into public.store_products (
        id, gym_id, inventory_item_id, name, categories, description, price, discount_percent, available, stock_qty, sort_order
      )
      select
        inv.store_product_id,
        inv.gym_id,
        inv.id,
        inv.name,
        case when inv.category <> '' then jsonb_build_array(inv.category) else '[]'::jsonb end,
        case when inv.category <> '' then '[' || inv.category || E']\n' else '' end,
        inv.price,
        0,
        (inv.qty > 0),
        inv.qty,
        0
      from public.pg_inventory_items inv
      where inv.gym_id = 'powergym-main' and inv.store_product_id <> ''
      on conflict (gym_id, id) do nothing;
    end if;

    -- 5.6 Migrate Trainers
    if jsonb_typeof(v_trainers) = 'array' then
      insert into public.pg_trainers (gym_id, id, name, phone, role)
      select
        'powergym-main',
        coalesce(nullif(t->>'id', ''), 'tr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(nullif(t->>'name', ''), 'مدرب'),
        coalesce(t->>'phone', ''),
        coalesce(t->>'role', '')
      from jsonb_array_elements(v_trainers) as t
      on conflict (gym_id, id) do nothing;
    end if;

    -- 5.7 Migrate WhatsApp Sent Logs
    if jsonb_typeof(v_wa_sent) = 'object' then
      insert into public.pg_whatsapp_logs (gym_id, log_key, sent_date, sent_by)
      select
        'powergym-main',
        kv.key,
        coalesce(private.safe_date(kv.value->>'date'), current_date),
        coalesce(kv.value->>'by', '')
      from jsonb_each(v_wa_sent) as kv
      on conflict (gym_id, log_key) do nothing;
    end if;
  end if;

  -- Migrate existing store_get_info / legacy store settings if any table existed
  if to_regclass('public.gym_sync') is not null then
    execute 'alter table public.gym_sync enable row level security';
    execute 'revoke all on table public.gym_sync from anon, authenticated';
  end if;
  if to_regclass('public.gym_access') is not null then
    execute 'alter table public.gym_access enable row level security';
    execute 'revoke all on table public.gym_access from anon, authenticated';
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='gym_access' and column_name='secret') then
      execute 'update public.gym_access set secret = replace(gen_random_uuid()::text, ''-'', '''') where gym_id = ''powergym-main''';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='gym_access' and column_name='secret_hash') then
      execute 'update public.gym_access set secret_hash = replace(gen_random_uuid()::text, ''-'', '''') where gym_id = ''powergym-main''';
    end if;
  end if;
end;
$$;

-- Lock down legacy unauthenticated RPCs if they exist
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gym_sync_pull', 'gym_sync_push', 'gym_access_init', 'pg_sync_structured_snapshot')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
  end loop;
end;
$$;

-- =====================================================================================
-- 6. Row Level Security (RLS) Policies & Explicit Privileges
-- =====================================================================================

-- Enable RLS across ALL tables
alter table public.pg_gyms enable row level security;
alter table public.pg_gym_memberships enable row level security;
alter table public.pg_gym_invites enable row level security;
alter table public.pg_members enable row level security;
alter table public.pg_member_freezes enable row level security;
alter table public.pg_attendance_logs enable row level security;
alter table public.pg_finance_transactions enable row level security;
alter table public.pg_debt_entries enable row level security;
alter table public.pg_debt_payments enable row level security;
alter table public.pg_subscription_renewals enable row level security;
alter table public.pg_receipts enable row level security;
alter table public.pg_inventory_items enable row level security;
alter table public.pg_sales_orders enable row level security;
alter table public.pg_trainers enable row level security;
alter table public.pg_daily_closes enable row level security;
alter table public.pg_accounting_archives enable row level security;
alter table public.pg_gym_status_reports enable row level security;
alter table public.pg_whatsapp_logs enable row level security;
alter table public.pg_audit_logs enable row level security;
alter table public.store_settings enable row level security;
alter table public.store_products enable row level security;
alter table public.store_reservations enable row level security;

-- Explicit Grants (Least Privilege)
revoke all on all tables in schema public from anon;

grant select on public.store_settings, public.store_products to anon, authenticated;
grant select, insert, update, delete on
  public.pg_gyms,
  public.pg_gym_memberships,
  public.pg_gym_invites,
  public.pg_members,
  public.pg_member_freezes,
  public.pg_attendance_logs,
  public.pg_finance_transactions,
  public.pg_debt_entries,
  public.pg_debt_payments,
  public.pg_subscription_renewals,
  public.pg_receipts,
  public.pg_inventory_items,
  public.pg_sales_orders,
  public.pg_trainers,
  public.pg_daily_closes,
  public.pg_accounting_archives,
  public.pg_gym_status_reports,
  public.pg_whatsapp_logs,
  public.pg_audit_logs,
  public.store_settings,
  public.store_products,
  public.store_reservations
to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- Drop & recreate clean idempotent policies
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'pg_gyms','pg_gym_memberships','pg_gym_invites','pg_members','pg_member_freezes',
        'pg_attendance_logs','pg_finance_transactions','pg_debt_entries','pg_debt_payments',
        'pg_subscription_renewals','pg_receipts','pg_inventory_items','pg_sales_orders',
        'pg_trainers','pg_daily_closes','pg_accounting_archives','pg_gym_status_reports',
        'pg_whatsapp_logs','pg_audit_logs','store_settings','store_products','store_reservations'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end;
$$;

-- pg_gyms policies
create policy pg_gyms_select on public.pg_gyms
  for select to authenticated
  using ((select private.has_gym_access(gym_id)));

create policy pg_gyms_update on public.pg_gyms
  for update to authenticated
  using ((select private.has_gym_access(gym_id)))
  with check ((select private.has_gym_access(gym_id)));

-- pg_gym_memberships policies
create policy pg_memberships_select on public.pg_gym_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_gym_manager(gym_id)));

create policy pg_memberships_manage on public.pg_gym_memberships
  for all to authenticated
  using ((select private.is_gym_manager(gym_id)))
  with check ((select private.is_gym_manager(gym_id)));

-- pg_gym_invites policies (Managers only)
create policy pg_invites_manager_all on public.pg_gym_invites
  for all to authenticated
  using ((select private.is_gym_manager(gym_id)))
  with check ((select private.is_gym_manager(gym_id)));

-- Staff Operational Tables (Owner, Captain, Supervisor)
do $$
declare
  t text;
begin
  foreach t in array array[
    'pg_members',
    'pg_member_freezes',
    'pg_attendance_logs',
    'pg_debt_entries',
    'pg_debt_payments',
    'pg_subscription_renewals',
    'pg_receipts',
    'pg_inventory_items',
    'pg_sales_orders',
    'pg_gym_status_reports',
    'pg_whatsapp_logs',
    'pg_audit_logs'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.has_gym_access(gym_id)))',
      t || '_staff_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.has_gym_access(gym_id)))',
      t || '_staff_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.has_gym_access(gym_id))) with check ((select private.has_gym_access(gym_id)))',
      t || '_staff_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_gym_manager(gym_id)))',
      t || '_manager_delete', t
    );
  end loop;
end;
$$;

-- Manager-Only Financial & Admin Tables (Enforced in PostgreSQL RLS!)
do $$
declare
  t text;
begin
  foreach t in array array[
    'pg_finance_transactions',
    'pg_trainers',
    'pg_daily_closes',
    'pg_accounting_archives'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_gym_manager(gym_id))) with check ((select private.is_gym_manager(gym_id)))',
      t || '_manager_all', t
    );
  end loop;
end;
$$;

-- Sub-Store Policies: Public Read for Storefront + Staff Management + Customer Own Reservations
create policy store_settings_public_read on public.store_settings
  for select to anon, authenticated
  using (true);

create policy store_settings_staff_write on public.store_settings
  for all to authenticated
  using ((select private.has_gym_access(gym_id)))
  with check ((select private.has_gym_access(gym_id)));

create policy store_products_public_read on public.store_products
  for select to anon, authenticated
  using (true);

create policy store_products_staff_write on public.store_products
  for all to authenticated
  using ((select private.has_gym_access(gym_id)))
  with check ((select private.has_gym_access(gym_id)));

create policy store_reservations_staff_all on public.store_reservations
  for all to authenticated
  using ((select private.has_gym_access(gym_id)))
  with check ((select private.has_gym_access(gym_id)));

create policy store_reservations_customer_own on public.store_reservations
  for select to authenticated
  using (customer_user_id = (select auth.uid()));

-- =====================================================================================
-- 7. Authenticated Gym Onboarding, Full-State Sync & Sub-Store RPCs
-- =====================================================================================

-- 7.1 Claim First Owner or Join Gym via Invite Token
create or replace function public.pg_claim_or_join_gym(
  p_gym text default 'powergym-main',
  p_invite_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := '';
  v_name text := '';
  v_avatar text := '';
  v_existing public.pg_gym_memberships%rowtype;
  v_has_owner boolean := false;
  v_inv public.pg_gym_invites%rowtype;
  v_gym text := coalesce(nullif(trim(p_gym), ''), 'powergym-main');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select
    coalesce(u.email, ''),
    coalesce(
      nullif(u.raw_user_meta_data->>'full_name', ''),
      nullif(u.raw_user_meta_data->>'name', ''),
      split_part(coalesce(u.email, 'الكابتن'), '@', 1)
    ),
    coalesce(
      nullif(u.raw_user_meta_data->>'avatar_url', ''),
      nullif(u.raw_user_meta_data->>'picture', ''),
      ''
    )
  into v_email, v_name, v_avatar
  from auth.users u
  where u.id = v_uid;

  -- Check if user already belongs to this gym (or any gym if default)
  select * into v_existing
  from public.pg_gym_memberships
  where user_id = v_uid and gym_id = v_gym and is_active = true
  limit 1;

  if not found and p_invite_token is null then
    select * into v_existing
    from public.pg_gym_memberships
    where user_id = v_uid and is_active = true
    order by created_at asc
    limit 1;
    if found then
      v_gym := v_existing.gym_id;
    end if;
  end if;

  if found then
    update public.pg_gym_memberships
    set email = v_email,
        avatar_url = case when v_avatar <> '' then v_avatar else avatar_url end,
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    return jsonb_build_object(
      'ok', true,
      'gym_id', v_existing.gym_id,
      'role', v_existing.role,
      'display_name', v_existing.display_name,
      'email', v_existing.email,
      'avatar_url', v_existing.avatar_url
    );
  end if;

  -- Invite token flow for supervisors/captains
  if p_invite_token is not null and trim(p_invite_token) <> '' then
    select * into v_inv
    from public.pg_gym_invites
    where token = trim(p_invite_token)
      and used_by is null
      and expires_at > now()
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired_invite');
    end if;

    insert into public.pg_gym_memberships (gym_id, user_id, email, display_name, avatar_url, role, is_active)
    values (v_inv.gym_id, v_uid, v_email, coalesce(nullif(v_inv.label, ''), v_name), v_avatar, v_inv.role, true)
    on conflict (gym_id, user_id) do update set
      role = excluded.role,
      is_active = true,
      email = excluded.email,
      avatar_url = excluded.avatar_url,
      updated_at = now()
    returning * into v_existing;

    update public.pg_gym_invites
    set used_by = v_uid, used_at = now()
    where token = v_inv.token;

    return jsonb_build_object(
      'ok', true,
      'gym_id', v_existing.gym_id,
      'role', v_existing.role,
      'display_name', v_existing.display_name,
      'email', v_existing.email,
      'avatar_url', v_existing.avatar_url
    );
  end if;

  -- Bootstrap: If powergym-main has no owner yet, the first signed-in user claims ownership!
  insert into public.pg_gyms (gym_id) values (v_gym) on conflict (gym_id) do nothing;
  insert into public.store_settings (gym_id) values (v_gym) on conflict (gym_id) do nothing;

  select exists (
    select 1 from public.pg_gym_memberships
    where gym_id = v_gym and role = 'owner' and is_active = true
  ) into v_has_owner;

  if not v_has_owner then
    insert into public.pg_gym_memberships (gym_id, user_id, email, display_name, avatar_url, role, is_active)
    values (v_gym, v_uid, v_email, v_name, v_avatar, 'owner', true)
    returning * into v_existing;

    return jsonb_build_object(
      'ok', true,
      'gym_id', v_existing.gym_id,
      'role', v_existing.role,
      'display_name', v_existing.display_name,
      'email', v_existing.email,
      'avatar_url', v_existing.avatar_url,
      'claimed_owner', true
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'reason', 'invite_required',
    'email', v_email
  );
end;
$$;

-- 7.2 Create Staff Invite Token (Managers Only)
create or replace function public.pg_create_staff_invite(
  p_gym text default 'powergym-main',
  p_role text default 'supervisor',
  p_label text default 'مشرف'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_role text := case when p_role = 'captain' then 'captain' else 'supervisor' end;
begin
  if v_uid is null or not private.is_gym_manager(p_gym) then
    raise exception 'forbidden';
  end if;

  v_token := 'inv_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.pg_gym_invites (token, gym_id, role, label, created_by)
  values (v_token, p_gym, v_role, coalesce(nullif(trim(p_label), ''), 'مشرف'), v_uid);

  return jsonb_build_object('ok', true, 'token', v_token, 'role', v_role);
end;
$$;

-- 7.3 Pull Full Normalized State in One Fast Round-Trip
create or replace function public.pg_pull_full_state(p_gym text default 'powergym-main')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := private.user_gym_role(p_gym);
  v_is_mgr boolean := v_role in ('owner', 'captain');
  v_gym_row public.pg_gyms%rowtype;
begin
  if v_role is null then
    raise exception 'unauthorized_gym_access';
  end if;

  select * into v_gym_row from public.pg_gyms where gym_id = p_gym;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'syncedAt', now(),
    'gym', jsonb_build_object(
      'gymName', v_gym_row.gym_name,
      'gymBranch', v_gym_row.branch,
      'supervisorName', v_gym_row.supervisor_name,
      'receiptStamp', v_gym_row.receipt_stamp,
      'defaultPrices', v_gym_row.default_prices,
      'crowd', jsonb_build_object('iron', v_gym_row.crowd_iron, 'cardio', v_gym_row.crowd_cardio, 'updatedAt', v_gym_row.crowd_updated_at),
      'opsSettings', v_gym_row.ops_settings,
      'waTemplates', v_gym_row.wa_templates,
      'receiptSettings', v_gym_row.receipt_settings,
      'manualProfitAdjustment', case when v_is_mgr then v_gym_row.manual_profit_adjustment else 0 end,
      'manualDebtAdjustment', v_gym_row.manual_debt_adjustment,
      'receiptCounter', v_gym_row.receipt_counter
    ),
    'staff', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'userId', m.user_id, 'email', m.email, 'displayName', m.display_name,
        'avatarUrl', m.avatar_url, 'role', m.role, 'isActive', m.is_active, 'createdAt', m.created_at
      ) order by m.created_at asc)
      from public.pg_gym_memberships m where m.gym_id = p_gym
    ), '[]'::jsonb) else '[]'::jsonb end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schemaVersion', '4.0.0',
        'id', p.id, 'code', p.code, 'name', p.name, 'age', p.age,
        'phone', p.phone, 'intlPhone', p.intl_phone, 'planType', p.plan_type,
        'startDate', p.start_date::text, 'durationMonths', p.duration_months, 'endDate', p.end_date::text,
        'paidAmount', p.paid_amount, 'debtAmount', p.debt_amount,
        'notes', p.notes, 'courseNotes', p.course_notes, 'courseImages', p.course_images,
        'attendanceCount', p.attendance_count, 'lastCheckIn', coalesce(p.last_check_in::text, ''),
        'photo', p.photo, 'telegramFileId', p.telegram_file_id, 'playerChatId', p.player_chat_id,
        'activationSent', p.activation_sent, 'threeDayRemindersSent', p.three_day_reminders_sent,
        'lastReminderDate', coalesce(p.last_reminder_date::text, ''),
        'coachSubmissionId', p.coach_submission_id,
        'createdAt', p.created_at, 'updatedAt', p.updated_at
      ) order by p.created_at desc)
      from public.pg_members p
      where p.gym_id = p_gym and p.deleted_at is null
    ), '[]'::jsonb),
    'deletedPlayerIds', coalesce((
      select jsonb_agg(p.id) from public.pg_members p where p.gym_id = p_gym and p.deleted_at is not null
    ), '[]'::jsonb),
    'freezes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'playerId', f.member_id, 'name', f.member_name,
        'startDate', f.start_date::text, 'endedAt', coalesce(f.ended_at::text, ''),
        'addedDays', f.added_days, 'by', f.created_by_name, 'updatedAt', f.updated_at
      ) order by f.created_at desc)
      from public.pg_member_freezes f where f.gym_id = p_gym
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'playerId', a.member_id, 'code', a.member_code,
        'name', a.member_name, 'date', a.check_in_date::text, 'time', a.check_in_time, 'type', a.check_type
      ) order by a.check_in_at desc)
      from (select * from public.pg_attendance_logs where gym_id = p_gym order by check_in_at desc limit 500) a
    ), '[]'::jsonb),
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'category', i.category, 'sku', i.sku,
        'qty', i.qty, 'minQty', i.min_qty, 'cost', i.cost, 'price', i.price,
        'storeProductId', i.store_product_id, 'showInStore', i.show_in_store, 'updatedAt', i.updated_at
      ) order by i.created_at desc)
      from public.pg_inventory_items i where i.gym_id = p_gym and i.deleted_at is null
    ), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'itemId', s.item_id, 'name', s.item_name, 'itemName', s.item_name,
        'category', s.category, 'qty', s.qty, 'unitPrice', s.unit_price, 'unitCost', s.unit_cost,
        'costTotal', s.unit_cost * s.qty, 'total', s.total, 'profit', s.profit,
        'source', s.source, 'date', s.sale_date::text, 'time', s.sale_time, 'createdAt', s.created_at
      ) order by s.created_at desc)
      from (select * from public.pg_sales_orders where gym_id = p_gym order by created_at desc limit 300) s
    ), '[]'::jsonb),
    'transactions', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'type', t.tx_type, 'category', t.category,
        'title', t.title, 'description', coalesce(nullif(t.description, ''), t.title),
        'amount', t.amount, 'date', t.tx_date::text, 'createdAt', t.created_at
      ) order by t.tx_date desc, t.created_at desc)
      from public.pg_finance_transactions t where t.gym_id = p_gym and t.deleted_at is null
    ), '[]'::jsonb) else '[]'::jsonb end,
    'debtEntries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'playerId', d.member_id, 'description', d.description,
        'amount', d.amount, 'paidAmount', d.paid_amount, 'date', d.entry_date::text,
        'notes', d.notes, 'createdAt', d.created_at
      ) order by d.entry_date desc, d.created_at desc)
      from public.pg_debt_entries d where d.gym_id = p_gym
    ), '[]'::jsonb),
    'debtPayments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dp.id, 'playerId', dp.member_id, 'title', dp.title,
        'amount', dp.amount, 'date', dp.payment_date::text, 'createdAt', dp.created_at
      ) order by dp.payment_date desc, dp.created_at desc)
      from public.pg_debt_payments dp where dp.gym_id = p_gym
    ), '[]'::jsonb),
    'renewals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'playerId', r.member_id, 'playerName', r.member_name,
        'startDate', r.start_date::text, 'endDate', r.end_date::text,
        'durationMonths', r.duration_months, 'paidAmount', r.paid_amount, 'date', r.renewal_date::text
      ) order by r.renewal_date desc, r.created_at desc)
      from public.pg_subscription_renewals r where r.gym_id = p_gym
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rc.id, 'serial', rc.serial, 'no', rc.receipt_no, 'type', rc.receipt_type,
        'date', rc.receipt_date::text, 'time', rc.receipt_time, 'createdAt', rc.created_at,
        'playerId', rc.member_id, 'playerName', rc.member_name, 'playerCode', rc.member_code, 'playerPhone', rc.member_phone,
        'description', rc.description, 'startDate', coalesce(rc.start_date::text, ''), 'endDate', coalesce(rc.end_date::text, ''),
        'durationMonths', rc.duration_months, 'listPrice', rc.list_price, 'discount', rc.discount,
        'subtotal', rc.subtotal, 'tax', rc.tax, 'taxPercent', rc.tax_percent, 'total', rc.total,
        'paid', rc.paid, 'remaining', rc.remaining, 'playerDebtAfter', rc.member_debt_after,
        'method', rc.payment_method, 'cashier', rc.cashier, 'txId', rc.tx_id,
        'printCount', rc.print_count, 'voided', rc.voided, 'voidReason', rc.void_reason, 'voidedAt', rc.voided_at
      ) order by rc.serial desc)
      from public.pg_receipts rc where rc.gym_id = p_gym
    ), '[]'::jsonb),
    'trainers', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object('id', tr.id, 'name', tr.name, 'phone', tr.phone, 'role', tr.role) order by tr.created_at desc)
      from public.pg_trainers tr where tr.gym_id = p_gym and tr.deleted_at is null
    ), '[]'::jsonb) else '[]'::jsonb end,
    'dailyCloses', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dc.id, 'date', dc.close_date::text, 'time', dc.close_time,
        'net', dc.net_expected, 'actual', dc.actual_cash, 'difference', dc.difference, 'notes', dc.notes
      ) order by dc.close_date desc)
      from public.pg_daily_closes dc where dc.gym_id = p_gym
    ), '[]'::jsonb) else '[]'::jsonb end,
    'accountingArchives', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ar.id, 'label', ar.label, 'netProfit', ar.net_profit,
        'totalIncome', ar.total_income, 'txExpense', ar.total_expense, 'date', ar.archive_date::text
      ) order by ar.created_at desc)
      from public.pg_accounting_archives ar where ar.gym_id = p_gym
    ), '[]'::jsonb) else '[]'::jsonb end,
    'statusReports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sr.id, 'by', sr.reported_by, 'iron', sr.iron_status, 'cardio', sr.cardio_status,
        'condition', sr.condition, 'note', sr.note, 'date', sr.report_date::text, 'time', sr.report_time, 'updatedAt', sr.created_at
      ) order by sr.created_at desc)
      from (select * from public.pg_gym_status_reports where gym_id = p_gym order by created_at desc limit 30) sr
    ), '[]'::jsonb),
    'whatsappSent', coalesce((
      select jsonb_object_agg(w.log_key, jsonb_build_object('date', w.sent_date::text, 'by', w.sent_by))
      from public.pg_whatsapp_logs w where w.gym_id = p_gym
    ), '{}'::jsonb)
  );
end;
$$;

-- 7.4 Push Structured State Changes Atomically to Normalized Tables
create or replace function public.pg_push_normalized_state(
  p_gym text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.user_gym_role(p_gym);
  v_is_mgr boolean := v_role in ('owner', 'captain');
  v_ledger jsonb;
  v_prof jsonb;
  v_crowd jsonb;
begin
  if v_role is null then
    raise exception 'unauthorized_gym_access';
  end if;

  -- 1. Profile / Crowd / Templates / Ops
  if p_payload ? 'profile' and jsonb_typeof(p_payload->'profile') = 'object' then
    v_prof := p_payload->'profile';
    update public.pg_gyms
    set
      gym_name = coalesce(nullif(v_prof->>'gymName', ''), gym_name),
      branch = coalesce(nullif(v_prof->>'gymBranch', ''), branch),
      supervisor_name = coalesce(v_prof->>'supervisorName', supervisor_name),
      receipt_stamp = coalesce(v_prof->>'receiptStamp', receipt_stamp),
      default_prices = case when jsonb_typeof(v_prof->'defaultPrices') = 'object' then v_prof->'defaultPrices' else default_prices end,
      updated_at = now()
    where gym_id = p_gym;
  end if;

  if p_payload ? 'crowd' and jsonb_typeof(p_payload->'crowd') = 'object' then
    v_crowd := p_payload->'crowd';
    update public.pg_gyms
    set
      crowd_iron = case when (v_crowd->>'iron') in ('low','medium','high') then v_crowd->>'iron' else crowd_iron end,
      crowd_cardio = case when (v_crowd->>'cardio') in ('low','medium','high') then v_crowd->>'cardio' else crowd_cardio end,
      crowd_updated_at = now(),
      updated_at = now()
    where gym_id = p_gym;
  end if;

  if p_payload ? 'waTemplates' and jsonb_typeof(p_payload->'waTemplates') = 'object' then
    update public.pg_gyms set wa_templates = p_payload->'waTemplates', updated_at = now() where gym_id = p_gym;
  end if;

  if p_payload ? 'opsSettings' and jsonb_typeof(p_payload->'opsSettings') = 'object' then
    update public.pg_gyms set ops_settings = p_payload->'opsSettings', updated_at = now() where gym_id = p_gym;
  end if;

  -- 2. Members Upsert + Tombstone Soft-Deletion for Removed IDs
  if p_payload ? 'players' and jsonb_typeof(p_payload->'players') = 'array' then
    -- If full players snapshot sent by manager, mark missing IDs as soft-deleted
    if v_is_mgr and coalesce((p_payload->>'playersFullSync')::boolean, false) then
      update public.pg_members pm
      set deleted_at = now(), updated_at = now()
      where pm.gym_id = p_gym
        and pm.deleted_at is null
        and not exists (
          select 1 from jsonb_array_elements(p_payload->'players') el
          where (el->>'id') = pm.id
        );
    end if;

    insert into public.pg_members (
      gym_id, id, code, name, age, phone, intl_phone, plan_type, duration_months,
      start_date, end_date, paid_amount, debt_amount, notes, course_notes, course_images,
      attendance_count, last_check_in, photo, telegram_file_id, player_chat_id,
      activation_sent, three_day_reminders_sent, last_reminder_date, coach_submission_id,
      deleted_at, created_at, updated_at
    )
    select
      p_gym,
      coalesce(nullif(m->>'id', ''), 'plr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(m->>'code', ''),
      coalesce(nullif(m->>'name', ''), 'مشترك'),
      least(80, greatest(10, private.safe_num(m->>'age', 20)::int))::smallint,
      coalesce(m->>'phone', ''),
      coalesce(m->>'intlPhone', ''),
      coalesce(nullif(m->>'planType', ''), 'حديد عام (كمال أجسام)'),
      greatest(0.5, private.safe_num(m->>'durationMonths', 1)),
      coalesce(private.safe_date(m->>'startDate'), current_date),
      coalesce(private.safe_date(m->>'endDate'), current_date + 30),
      greatest(0, private.safe_num(m->>'paidAmount', 0)),
      greatest(0, private.safe_num(m->>'debtAmount', 0)),
      coalesce(m->>'notes', ''),
      coalesce(m->>'courseNotes', ''),
      case when jsonb_typeof(m->'courseImages') = 'array' then m->'courseImages' else '[]'::jsonb end,
      greatest(0, private.safe_num(m->>'attendanceCount', 0)::int),
      private.safe_date(m->>'lastCheckIn'),
      coalesce(m->>'photo', ''),
      coalesce(m->>'telegramFileId', ''),
      coalesce(m->>'playerChatId', ''),
      coalesce((m->>'activationSent')::boolean, false),
      case when jsonb_typeof(m->'threeDayRemindersSent') = 'array' then m->'threeDayRemindersSent' else '[]'::jsonb end,
      private.safe_date(m->>'lastReminderDate'),
      coalesce(m->>'coachSubmissionId', ''),
      null,
      private.safe_timestamptz(m->>'createdAt'),
      private.safe_timestamptz(m->>'updatedAt')
    from jsonb_array_elements(p_payload->'players') as m
    on conflict (gym_id, id) do update set
      code = excluded.code,
      name = excluded.name,
      age = excluded.age,
      phone = excluded.phone,
      intl_phone = excluded.intl_phone,
      plan_type = excluded.plan_type,
      duration_months = excluded.duration_months,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      paid_amount = excluded.paid_amount,
      debt_amount = excluded.debt_amount,
      notes = excluded.notes,
      course_notes = excluded.course_notes,
      course_images = excluded.course_images,
      attendance_count = excluded.attendance_count,
      last_check_in = excluded.last_check_in,
      photo = excluded.photo,
      telegram_file_id = excluded.telegram_file_id,
      player_chat_id = excluded.player_chat_id,
      activation_sent = excluded.activation_sent,
      three_day_reminders_sent = excluded.three_day_reminders_sent,
      last_reminder_date = excluded.last_reminder_date,
      deleted_at = null,
      updated_at = now();
  end if;

  if p_payload ? 'deletedPlayerIds' and jsonb_typeof(p_payload->'deletedPlayerIds') = 'array' and v_is_mgr then
    update public.pg_members
    set deleted_at = now(), updated_at = now()
    where gym_id = p_gym
      and id in (select jsonb_array_elements_text(p_payload->'deletedPlayerIds'));
  end if;

  -- 3. Freezes
  if p_payload ? 'freezes' and jsonb_typeof(p_payload->'freezes') = 'array' then
    insert into public.pg_member_freezes (
      gym_id, id, member_id, member_name, start_date, ended_at, added_days, created_by_name, updated_at
    )
    select
      p_gym,
      coalesce(nullif(f->>'id', ''), 'frz_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(f->>'playerId', ''),
      coalesce(f->>'name', ''),
      coalesce(private.safe_date(f->>'startDate'), current_date),
      private.safe_date(f->>'endedAt'),
      greatest(0, private.safe_num(f->>'addedDays', 0)::int),
      coalesce(f->>'by', ''),
      now()
    from jsonb_array_elements(p_payload->'freezes') as f
    where coalesce(f->>'playerId', '') <> ''
    on conflict (gym_id, id) do update set
      ended_at = excluded.ended_at,
      added_days = excluded.added_days,
      updated_at = now();
  end if;

  -- 4. Attendance
  if p_payload ? 'attendance' and jsonb_typeof(p_payload->'attendance') = 'array' then
    insert into public.pg_attendance_logs (
      gym_id, id, member_id, member_code, member_name, check_in_date, check_in_time, check_type
    )
    select
      p_gym,
      coalesce(nullif(a->>'id', ''), 'att_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(a->>'playerId', ''),
      coalesce(a->>'code', ''),
      coalesce(a->>'name', ''),
      coalesce(private.safe_date(a->>'date'), current_date),
      coalesce(a->>'time', ''),
      coalesce(nullif(a->>'type', ''), 'in')
    from jsonb_array_elements(p_payload->'attendance') as a
    where coalesce(a->>'playerId', '') <> ''
    on conflict (gym_id, id) do nothing;
  end if;

  -- 5. Finance Ledger (Debts, Payments, Renewals, Receipts + Manager-only Transactions)
  if p_payload ? 'financeLedger' and jsonb_typeof(p_payload->'financeLedger') = 'object' then
    v_ledger := p_payload->'financeLedger';

    update public.pg_gyms
    set
      manual_profit_adjustment = case when v_is_mgr then private.safe_num(v_ledger->>'manualProfitAdjustment', manual_profit_adjustment) else manual_profit_adjustment end,
      manual_debt_adjustment = private.safe_num(v_ledger->>'manualDebtAdjustment', manual_debt_adjustment),
      receipt_counter = greatest(receipt_counter, private.safe_num(v_ledger->>'receiptCounter', 0)::int),
      receipt_settings = case when jsonb_typeof(v_ledger->'receiptSettings') = 'object' then v_ledger->'receiptSettings' else receipt_settings end,
      updated_at = now()
    where gym_id = p_gym;

    if v_is_mgr and jsonb_typeof(v_ledger->'transactions') = 'array' then
      update public.pg_finance_transactions ft
      set deleted_at = now(), updated_at = now()
      where ft.gym_id = p_gym
        and ft.deleted_at is null
        and not exists (
          select 1 from jsonb_array_elements(v_ledger->'transactions') tx
          where (tx->>'id') = ft.id
        );

      insert into public.pg_finance_transactions (
        gym_id, id, tx_type, category, title, description, amount, tx_date, deleted_at, created_at, updated_at
      )
      select
        p_gym,
        coalesce(nullif(tx->>'id', ''), 'tx_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        case when (tx->>'type') = 'expense' then 'expense' else 'income' end,
        coalesce(tx->>'category', ''),
        coalesce(nullif(tx->>'title', ''), coalesce(nullif(tx->>'description', ''), 'حركة مالية')),
        coalesce(tx->>'description', coalesce(tx->>'title', '')),
        private.safe_num(tx->>'amount', 0),
        coalesce(private.safe_date(tx->>'date'), current_date),
        null,
        private.safe_timestamptz(tx->>'createdAt'),
        now()
      from jsonb_array_elements(v_ledger->'transactions') as tx
      on conflict (gym_id, id) do update set
        tx_type = excluded.tx_type,
        title = excluded.title,
        description = excluded.description,
        amount = excluded.amount,
        tx_date = excluded.tx_date,
        deleted_at = null,
        updated_at = now();
    end if;

    if jsonb_typeof(v_ledger->'debtEntries') = 'array' then
      insert into public.pg_debt_entries (
        gym_id, id, member_id, description, amount, paid_amount, entry_date, notes, created_at, updated_at
      )
      select
        p_gym,
        coalesce(nullif(d->>'id', ''), 'debt_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(d->>'playerId', ''),
        coalesce(nullif(d->>'description', ''), 'دين'),
        private.safe_num(d->>'amount', 0),
        private.safe_num(d->>'paidAmount', 0),
        coalesce(private.safe_date(d->>'date'), current_date),
        coalesce(d->>'notes', ''),
        private.safe_timestamptz(d->>'createdAt'),
        now()
      from jsonb_array_elements(v_ledger->'debtEntries') as d
      where coalesce(d->>'playerId', '') <> ''
      on conflict (gym_id, id) do update set
        paid_amount = excluded.paid_amount,
        amount = excluded.amount,
        updated_at = now();
    end if;

    if jsonb_typeof(v_ledger->'debtPayments') = 'array' then
      insert into public.pg_debt_payments (gym_id, id, member_id, title, amount, payment_date)
      select
        p_gym,
        coalesce(nullif(dp->>'id', ''), 'pay_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(dp->>'playerId', ''),
        coalesce(dp->>'title', ''),
        private.safe_num(dp->>'amount', 0),
        coalesce(private.safe_date(dp->>'date'), current_date)
      from jsonb_array_elements(v_ledger->'debtPayments') as dp
      where coalesce(dp->>'playerId', '') <> ''
      on conflict (gym_id, id) do nothing;
    end if;

    if jsonb_typeof(v_ledger->'renewals') = 'array' then
      insert into public.pg_subscription_renewals (
        gym_id, id, member_id, member_name, start_date, end_date, duration_months, paid_amount, renewal_date
      )
      select
        p_gym,
        coalesce(nullif(r->>'id', ''), 'ren_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        coalesce(r->>'playerId', ''),
        coalesce(r->>'playerName', ''),
        coalesce(private.safe_date(r->>'startDate'), current_date),
        coalesce(private.safe_date(r->>'endDate'), current_date + 30),
        private.safe_num(r->>'durationMonths', 1),
        private.safe_num(r->>'paidAmount', 0),
        coalesce(private.safe_date(r->>'date'), current_date)
      from jsonb_array_elements(v_ledger->'renewals') as r
      where coalesce(r->>'playerId', '') <> ''
      on conflict (gym_id, id) do nothing;
    end if;

    if jsonb_typeof(v_ledger->'receipts') = 'array' then
      insert into public.pg_receipts (
        gym_id, id, serial, receipt_no, receipt_type, receipt_date, receipt_time,
        member_id, member_name, member_code, member_phone, description,
        start_date, end_date, duration_months, list_price, discount, subtotal,
        tax, tax_percent, total, paid, remaining, member_debt_after,
        payment_method, cashier, tx_id, print_count, voided, void_reason, voided_at, created_at, updated_at
      )
      select
        p_gym,
        coalesce(nullif(rc->>'id', ''), 'rcp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        greatest(1, private.safe_num(rc->>'serial', 1)::int),
        coalesce(nullif(rc->>'no', ''), 'PG-R-000001'),
        coalesce(nullif(rc->>'type', ''), 'subscription'),
        coalesce(private.safe_date(rc->>'date'), current_date),
        coalesce(rc->>'time', ''),
        coalesce(rc->>'playerId', ''),
        coalesce(nullif(rc->>'playerName', ''), 'زبون'),
        coalesce(rc->>'playerCode', ''),
        coalesce(rc->>'playerPhone', ''),
        coalesce(rc->>'description', ''),
        private.safe_date(rc->>'startDate'),
        private.safe_date(rc->>'endDate'),
        private.safe_num(rc->>'durationMonths', 0),
        private.safe_num(rc->>'listPrice', 0),
        private.safe_num(rc->>'discount', 0),
        private.safe_num(rc->>'subtotal', 0),
        private.safe_num(rc->>'tax', 0),
        private.safe_num(rc->>'taxPercent', 0),
        private.safe_num(rc->>'total', 0),
        private.safe_num(rc->>'paid', 0),
        private.safe_num(rc->>'remaining', 0),
        private.safe_num(rc->>'playerDebtAfter', 0),
        coalesce(nullif(rc->>'method', ''), 'cash'),
        coalesce(rc->>'cashier', ''),
        coalesce(rc->>'txId', ''),
        greatest(0, private.safe_num(rc->>'printCount', 0)::int),
        coalesce((rc->>'voided')::boolean, false),
        coalesce(rc->>'voidReason', ''),
        case when coalesce((rc->>'voided')::boolean, false) then private.safe_timestamptz(rc->>'voidedAt') else null end,
        private.safe_timestamptz(rc->>'createdAt'),
        now()
      from jsonb_array_elements(v_ledger->'receipts') as rc
      on conflict (gym_id, id) do update set
        print_count = excluded.print_count,
        voided = excluded.voided,
        void_reason = excluded.void_reason,
        voided_at = excluded.voided_at,
        updated_at = now();
    end if;
  end if;

  -- 6. Inventory & Sales (with Automatic Sub-Store Stock Synchronization!)
  if p_payload ? 'inventory' and jsonb_typeof(p_payload->'inventory') = 'array' then
    if v_is_mgr then
      update public.pg_inventory_items inv
      set deleted_at = now(), updated_at = now()
      where inv.gym_id = p_gym
        and inv.deleted_at is null
        and not exists (
          select 1 from jsonb_array_elements(p_payload->'inventory') el
          where (el->>'id') = inv.id
        );
    end if;

    insert into public.pg_inventory_items (
      gym_id, id, name, category, sku, qty, min_qty, cost, price, store_product_id, show_in_store, deleted_at, updated_at
    )
    select
      p_gym,
      coalesce(nullif(i->>'id', ''), 'itm_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(nullif(i->>'name', ''), 'منتج'),
      coalesce(nullif(i->>'category', ''), 'مكملات'),
      coalesce(i->>'sku', ''),
      greatest(0, private.safe_num(i->>'qty', 0)::int),
      greatest(0, private.safe_num(i->>'minQty', 3)::int),
      greatest(0, private.safe_num(i->>'cost', 0)),
      greatest(0, private.safe_num(i->>'price', 0)),
      coalesce(i->>'storeProductId', ''),
      coalesce((i->>'showInStore')::boolean, true),
      null,
      now()
    from jsonb_array_elements(p_payload->'inventory') as i
    on conflict (gym_id, id) do update set
      name = excluded.name,
      category = excluded.category,
      sku = excluded.sku,
      qty = excluded.qty,
      min_qty = excluded.min_qty,
      cost = excluded.cost,
      price = excluded.price,
      store_product_id = case when excluded.store_product_id <> '' then excluded.store_product_id else public.pg_inventory_items.store_product_id end,
      show_in_store = excluded.show_in_store,
      deleted_at = null,
      updated_at = now();

    -- Sync linked store_products stock & availability
    update public.store_products sp
    set
      stock_qty = inv.qty,
      available = (inv.qty > 0),
      price = inv.price,
      updated_at = now()
    from public.pg_inventory_items inv
    where sp.gym_id = p_gym
      and inv.gym_id = p_gym
      and inv.deleted_at is null
      and inv.store_product_id = sp.id;
  end if;

  if p_payload ? 'sales' and jsonb_typeof(p_payload->'sales') = 'array' then
    insert into public.pg_sales_orders (
      gym_id, id, item_id, item_name, category, qty, unit_price, unit_cost, total, profit, source, sale_date, sale_time
    )
    select
      p_gym,
      coalesce(nullif(s->>'id', ''), 'sale_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(s->>'itemId', ''),
      coalesce(nullif(s->>'itemName', ''), coalesce(nullif(s->>'name', ''), 'مبيع')),
      coalesce(s->>'category', 'عام'),
      greatest(1, private.safe_num(s->>'qty', 1)::int),
      private.safe_num(s->>'unitPrice', 0),
      private.safe_num(s->>'unitCost', 0),
      private.safe_num(s->>'total', 0),
      private.safe_num(s->>'profit', 0),
      coalesce(s->>'source', 'المخزن'),
      coalesce(private.safe_date(s->>'date'), current_date),
      coalesce(s->>'time', '')
    from jsonb_array_elements(p_payload->'sales') as s
    on conflict (gym_id, id) do nothing;
  end if;

  -- 7. Trainers, Daily Closes, Archives, Status Reports, WhatsApp Logs
  if v_is_mgr and p_payload ? 'trainers' and jsonb_typeof(p_payload->'trainers') = 'array' then
    update public.pg_trainers tr
    set deleted_at = now(), updated_at = now()
    where tr.gym_id = p_gym
      and tr.deleted_at is null
      and not exists (select 1 from jsonb_array_elements(p_payload->'trainers') t where (t->>'id') = tr.id);

    insert into public.pg_trainers (gym_id, id, name, phone, role, deleted_at, updated_at)
    select
      p_gym,
      coalesce(nullif(t->>'id', ''), 'tr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(nullif(t->>'name', ''), 'مدرب'),
      coalesce(t->>'phone', ''),
      coalesce(t->>'role', ''),
      null,
      now()
    from jsonb_array_elements(p_payload->'trainers') as t
    on conflict (gym_id, id) do update set
      name = excluded.name, phone = excluded.phone, role = excluded.role, deleted_at = null, updated_at = now();
  end if;

  if v_is_mgr and p_payload ? 'dailyCloses' and jsonb_typeof(p_payload->'dailyCloses') = 'array' then
    insert into public.pg_daily_closes (gym_id, id, close_date, close_time, net_expected, actual_cash, difference, notes)
    select
      p_gym,
      coalesce(nullif(dc->>'id', ''), 'close_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(private.safe_date(dc->>'date'), current_date),
      coalesce(dc->>'time', ''),
      private.safe_num(dc->>'net', 0),
      private.safe_num(dc->>'actual', 0),
      private.safe_num(dc->>'difference', 0),
      coalesce(dc->>'notes', '')
    from jsonb_array_elements(p_payload->'dailyCloses') as dc
    on conflict (gym_id, id) do nothing;
  end if;

  if v_is_mgr and p_payload ? 'accountingArchives' and jsonb_typeof(p_payload->'accountingArchives') = 'array' then
    insert into public.pg_accounting_archives (gym_id, id, label, net_profit, total_income, total_expense, archive_date)
    select
      p_gym,
      coalesce(nullif(ar->>'id', ''), 'arc_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(nullif(ar->>'label', ''), to_char(current_date, 'YYYY-MM')),
      private.safe_num(ar->>'netProfit', 0),
      private.safe_num(ar->>'totalIncome', 0),
      private.safe_num(ar->>'txExpense', 0),
      coalesce(private.safe_date(ar->>'date'), current_date)
    from jsonb_array_elements(p_payload->'accountingArchives') as ar
    on conflict (gym_id, id) do nothing;
  end if;

  if p_payload ? 'statusReports' and jsonb_typeof(p_payload->'statusReports') = 'array' then
    insert into public.pg_gym_status_reports (gym_id, id, reported_by, iron_status, cardio_status, condition, note, report_date, report_time)
    select
      p_gym,
      coalesce(nullif(sr->>'id', ''), 'rep_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      coalesce(sr->>'by', ''),
      coalesce(sr->>'iron', 'medium'),
      coalesce(sr->>'cardio', 'low'),
      coalesce(sr->>'condition', ''),
      coalesce(sr->>'note', ''),
      coalesce(private.safe_date(sr->>'date'), current_date),
      coalesce(sr->>'time', '')
    from jsonb_array_elements(p_payload->'statusReports') as sr
    on conflict (gym_id, id) do nothing;
  end if;

  if p_payload ? 'whatsappSent' and jsonb_typeof(p_payload->'whatsappSent') = 'object' then
    insert into public.pg_whatsapp_logs (gym_id, log_key, sent_date, sent_by, updated_at)
    select
      p_gym,
      kv.key,
      coalesce(private.safe_date(kv.value->>'date'), current_date),
      coalesce(kv.value->>'by', ''),
      now()
    from jsonb_each(p_payload->'whatsappSent') as kv
    on conflict (gym_id, log_key) do update set
      sent_date = excluded.sent_date,
      sent_by = excluded.sent_by,
      updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'syncedAt', now(), 'actor', v_uid);
end;
$$;

-- =====================================================================================
-- 8. Sub-Store ("متجر القاعة") Clean RPCs (Public Storefront + Authenticated Staff)
-- =====================================================================================

-- Drop any legacy store_* overloads (e.g. old PIN-based signatures) to avoid overload ambiguity or return-type conflicts
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'store_init',
        'store_get_info',
        'store_save_settings',
        'store_upsert_product',
        'store_delete_product',
        'store_list_reservations',
        'store_set_reservation_status',
        'store_reserve',
        'store_my_reservations'
      )
  loop
    execute format('drop function if exists %s', fn.sig);
  end loop;
end;
$$;

create or replace function public.store_get_info(p_gym text default 'powergym-main')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.store_settings%rowtype;
  g public.pg_gyms%rowtype;
  v_packed jsonb;
begin
  select * into s from public.store_settings where gym_id = p_gym;
  select * into g from public.pg_gyms where gym_id = p_gym;

  if not found and s.gym_id is null then
    return jsonb_build_object('configured', false, 'store_name', 'متجر القاعة', 'whatsapp', '', 'note', '');
  end if;

  v_packed := jsonb_build_object(
    't', coalesce(s.top_note, ''),
    'c', coalesce(s.brand_color, '#f59e0b'),
    'bg', coalesce(s.theme_bg, 'dark'),
    'open', case when coalesce(s.is_open, true) then 1 else 0 end,
    'so', case when coalesce(s.show_sold_out, true) then 1 else 0 end,
    'nt', case when coalesce(s.allow_customer_note, true) then 1 else 0 end,
    'hr', coalesce(s.working_hours, ''),
    'cur', coalesce(s.currency, 'د.ع'),
    'cat', coalesce((select string_agg(val, ',') from jsonb_array_elements_text(coalesce(s.categories, '[]'::jsonb)) val), ''),
    'promoOn', case when coalesce(s.promo_enabled, true) then 1 else 0 end,
    'promoSpd', coalesce(s.promo_speed_sec, 4),
    'promos', coalesce(s.promos, '[]'::jsonb)
  );

  return jsonb_build_object(
    'configured', true,
    'gym_id', coalesce(s.gym_id, p_gym),
    'store_name', coalesce(nullif(s.store_name, ''), coalesce(g.gym_name, 'متجر Power Gym')),
    'whatsapp', coalesce(s.whatsapp, ''),
    'top_note', coalesce(s.top_note, ''),
    'working_hours', coalesce(s.working_hours, ''),
    'currency', coalesce(s.currency, 'د.ع'),
    'theme_bg', coalesce(s.theme_bg, 'dark'),
    'brand_color', coalesce(s.brand_color, '#f59e0b'),
    'is_open', coalesce(s.is_open, true),
    'show_sold_out', coalesce(s.show_sold_out, true),
    'allow_customer_note', coalesce(s.allow_customer_note, true),
    'categories', coalesce(s.categories, '[]'::jsonb),
    'promo_enabled', coalesce(s.promo_enabled, true),
    'promo_speed_sec', coalesce(s.promo_speed_sec, 4),
    'promos', coalesce(s.promos, '[]'::jsonb),
    'note', case when coalesce(s.note, '') <> '' and s.note like '{%' then s.note else v_packed::text end
  );
end;
$$;

create or replace function public.store_save_settings(
  p_gym text,
  p_name text,
  p_whatsapp text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parsed jsonb := '{}'::jsonb;
  v_cats jsonb := '[]'::jsonb;
begin
  if not private.has_gym_access(p_gym) then
    raise exception 'unauthorized_gym_access';
  end if;

  begin
    if p_note is not null and trim(p_note) like '{%' then
      v_parsed := p_note::jsonb;
    end if;
  exception when others then
    v_parsed := '{}'::jsonb;
  end;

  if coalesce(v_parsed->>'cat', '') <> '' then
    select coalesce(jsonb_agg(trim(x)) filter (where trim(x) <> ''), '[]'::jsonb)
    into v_cats
    from regexp_split_to_table(v_parsed->>'cat', '[,،]') as x;
  end if;

  insert into public.store_settings (
    gym_id, store_name, whatsapp, top_note, working_hours, currency,
    theme_bg, brand_color, is_open, show_sold_out, allow_customer_note,
    categories, promo_enabled, promo_speed_sec, promos, note, updated_at
  )
  values (
    p_gym,
    coalesce(nullif(trim(p_name), ''), 'متجر Power Gym'),
    coalesce(trim(p_whatsapp), ''),
    coalesce(v_parsed->>'t', ''),
    coalesce(v_parsed->>'hr', ''),
    coalesce(nullif(v_parsed->>'cur', ''), 'د.ع'),
    case when (v_parsed->>'bg') in ('dark','light','soft') then v_parsed->>'bg' else 'dark' end,
    coalesce(nullif(v_parsed->>'c', ''), '#f59e0b'),
    coalesce((v_parsed->>'open')::int, 1) <> 0,
    coalesce((v_parsed->>'so')::int, 1) <> 0,
    coalesce((v_parsed->>'nt')::int, 1) <> 0,
    v_cats,
    coalesce((v_parsed->>'promoOn')::int, 1) <> 0,
    least(12, greatest(2, coalesce((v_parsed->>'promoSpd')::int, 4)))::smallint,
    case when jsonb_typeof(v_parsed->'promos') = 'array' then v_parsed->'promos' else '[]'::jsonb end,
    coalesce(p_note, ''),
    now()
  )
  on conflict (gym_id) do update set
    store_name = excluded.store_name,
    whatsapp = excluded.whatsapp,
    top_note = excluded.top_note,
    working_hours = excluded.working_hours,
    currency = excluded.currency,
    theme_bg = excluded.theme_bg,
    brand_color = excluded.brand_color,
    is_open = excluded.is_open,
    show_sold_out = excluded.show_sold_out,
    allow_customer_note = excluded.allow_customer_note,
    categories = excluded.categories,
    promo_enabled = excluded.promo_enabled,
    promo_speed_sec = excluded.promo_speed_sec,
    promos = excluded.promos,
    note = excluded.note,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.store_upsert_product(
  p_gym text,
  p jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := coalesce(nullif(trim(p->>'id'), ''), 'prd_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text);
  v_name text := trim(coalesce(p->>'name', ''));
  v_price numeric(12,2) := greatest(0, private.safe_num(p->>'price', 0));
  v_disc numeric(5,2) := least(100, greatest(0, private.safe_num(p->>'discount_percent', 0)));
  v_desc text := coalesce(p->>'description', '');
  v_img text := coalesce(p->>'image', '');
  v_avail boolean := coalesce((p->>'available')::boolean, true);
  v_sort int := private.safe_num(p->>'sort_order', 0)::int;
  v_stock int := greatest(0, private.safe_num(p->>'stock_qty', case when v_avail then 10 else 0 end)::int);
  v_inv_id text := coalesce(nullif(p->>'inventory_item_id', ''), 'itm_' || regexp_replace(v_id, '^prd_', ''));
  v_cats jsonb := case when jsonb_typeof(p->'categories') = 'array' then p->'categories' else '[]'::jsonb end;
  v_first_cat text := 'مكملات';
begin
  if not private.has_gym_access(p_gym) then
    raise exception 'unauthorized_gym_access';
  end if;
  if v_name = '' then
    raise exception 'invalid_product';
  end if;

  if jsonb_array_length(v_cats) > 0 then
    v_first_cat := v_cats->>0;
  end if;

  insert into public.store_products (
    id, gym_id, inventory_item_id, name, categories, description,
    price, discount_percent, image, available, stock_qty, sort_order, updated_at
  )
  values (
    v_id, p_gym, v_inv_id, v_name, v_cats, v_desc,
    v_price, v_disc, v_img, v_avail, v_stock, v_sort, now()
  )
  on conflict (gym_id, id) do update set
    name = excluded.name,
    categories = case when jsonb_array_length(excluded.categories) > 0 then excluded.categories else public.store_products.categories end,
    description = excluded.description,
    price = excluded.price,
    discount_percent = excluded.discount_percent,
    image = excluded.image,
    available = excluded.available,
    stock_qty = excluded.stock_qty,
    sort_order = excluded.sort_order,
    updated_at = now();

  -- Automatically keep pg_inventory_items synchronized!
  insert into public.pg_inventory_items (
    gym_id, id, name, category, qty, price, store_product_id, show_in_store, deleted_at, updated_at
  )
  values (
    p_gym, v_inv_id, v_name, v_first_cat, case when v_avail then greatest(1, v_stock) else 0 end, v_price, v_id, true, null, now()
  )
  on conflict (gym_id, id) do update set
    name = excluded.name,
    price = excluded.price,
    store_product_id = v_id,
    qty = case when not v_avail then 0 else greatest(public.pg_inventory_items.qty, excluded.qty) end,
    deleted_at = null,
    updated_at = now();

  return jsonb_build_object('ok', true, 'id', v_id, 'inventory_item_id', v_inv_id);
end;
$$;

create or replace function public.store_delete_product(
  p_gym text,
  p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.has_gym_access(p_gym) then
    raise exception 'unauthorized_gym_access';
  end if;

  delete from public.store_products where gym_id = p_gym and id = p_id;
  update public.pg_inventory_items
  set store_product_id = '', show_in_store = false, updated_at = now()
  where gym_id = p_gym and store_product_id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.store_list_reservations(p_gym text default 'powergym-main')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not private.has_gym_access(p_gym) then
    raise exception 'unauthorized_gym_access';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'gym_id', r.gym_id,
      'product_id', r.product_id,
      'product_name', r.product_name,
      'unit_price', r.unit_price,
      'qty', r.qty,
      'total_price', r.total_price,
      'customer_user_id', r.customer_user_id,
      'customer_email', r.customer_email,
      'customer_name', r.customer_name,
      'customer_phone', r.customer_phone,
      'note', r.note,
      'status', r.status,
      'delivered_at', r.delivered_at,
      'created_at', r.created_at
    ) order by r.created_at desc)
    from public.store_reservations r
    where r.gym_id = p_gym
  ), '[]'::jsonb);
end;
$$;

-- Server-Side Atomic Delivery: Deducts Inventory + Records Sale + Adds Profit Transaction!
create or replace function public.store_set_reservation_status(
  p_gym text,
  p_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.store_reservations%rowtype;
  inv public.pg_inventory_items%rowtype;
  v_unit_price numeric(12,2);
  v_total numeric(12,2);
  v_profit numeric(12,2);
  v_rem int := null;
  v_out boolean := false;
begin
  if not private.has_gym_access(p_gym) then
    raise exception 'unauthorized_gym_access';
  end if;
  if p_status not in ('new', 'contacted', 'delivered', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  select * into r
  from public.store_reservations
  where gym_id = p_gym and id::text = p_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  update public.store_reservations
  set
    status = p_status,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    updated_at = now()
  where gym_id = p_gym and id::text = p_id;

  -- Atomic stock deduction & revenue recording ONLY when transitioning into 'delivered'
  if p_status = 'delivered' and r.status <> 'delivered' then
    select * into inv
    from public.pg_inventory_items
    where gym_id = p_gym
      and deleted_at is null
      and (store_product_id = r.product_id or lower(trim(name)) = lower(trim(r.product_name)))
    limit 1
    for update;

    v_unit_price := case when r.unit_price > 0 then r.unit_price else coalesce(inv.price, 0) end;
    v_total := case when r.total_price > 0 then r.total_price else v_unit_price * r.qty end;
    v_profit := v_total - (coalesce(inv.cost, 0) * r.qty);

    if found then
      v_rem := greatest(0, inv.qty - r.qty);
      v_out := (v_rem <= 0);

      update public.pg_inventory_items
      set qty = v_rem, updated_at = now()
      where gym_id = p_gym and id = inv.id;

      update public.store_products
      set stock_qty = v_rem, available = not v_out, updated_at = now()
      where gym_id = p_gym and id = r.product_id;
    end if;

    insert into public.pg_sales_orders (
      gym_id, id, item_id, item_name, category, qty, unit_price, unit_cost, total, profit, source, sale_date, sale_time, reservation_id
    )
    values (
      p_gym,
      'sale_res_' || regexp_replace(p_id, '[^a-zA-Z0-9_-]', '', 'g'),
      coalesce(inv.id, r.product_id),
      r.product_name,
      coalesce(inv.category, 'متجر القاعة'),
      r.qty,
      v_unit_price,
      coalesce(inv.cost, 0),
      v_total,
      v_profit,
      'بيع من المتجر',
      (now() at time zone 'Asia/Baghdad')::date,
      to_char(now() at time zone 'Asia/Baghdad', 'HH24:MI'),
      p_id
    )
    on conflict (gym_id, id) do nothing;

    if v_total > 0 then
      insert into public.pg_finance_transactions (
        gym_id, id, tx_type, category, title, description, amount, tx_date
      )
      values (
        p_gym,
        'tx_res_' || regexp_replace(p_id, '[^a-zA-Z0-9_-]', '', 'g'),
        'income',
        'متجر القاعة',
        format('مبيع متجر: %s × %s (%s)', r.product_name, r.qty, r.customer_name),
        format('تسليم حجز متجر للزبون %s (%s)', r.customer_name, r.customer_phone),
        v_total,
        (now() at time zone 'Asia/Baghdad')::date
      )
      on conflict (gym_id, id) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', p_status,
    'remaining_qty', v_rem,
    'out_of_stock', v_out,
    'total', coalesce(v_total, 0)
  );
end;
$$;

-- Public Validated Store Reservation RPC (Supports Guest OR Google-Signed-In Customer!)
create or replace function public.store_reserve(
  p_gym text,
  p_product_id text,
  p_qty integer,
  p_name text,
  p_phone text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := '';
  v_prod public.store_products%rowtype;
  v_settings public.store_settings%rowtype;
  v_clean_name text := trim(coalesce(p_name, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_unit_price numeric(12,2);
  v_total numeric(12,2);
  v_recent_count int := 0;
  v_res_id text;
begin
  if char_length(v_clean_name) < 2 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_digits) < 7 or char_length(v_digits) > 15 then
    raise exception 'invalid_phone';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then
    raise exception 'invalid_qty';
  end if;

  select * into v_settings from public.store_settings where gym_id = p_gym;
  if found and not v_settings.is_open then
    raise exception 'product_unavailable';
  end if;

  -- Simple anti-spam check per phone number (max 6 reservations in 10 minutes)
  select count(*) into v_recent_count
  from public.store_reservations
  where gym_id = p_gym
    and regexp_replace(customer_phone, '\D', '', 'g') = v_digits
    and created_at > now() - interval '10 minutes';

  if v_recent_count >= 6 then
    raise exception 'too_many';
  end if;

  select * into v_prod
  from public.store_products
  where gym_id = p_gym and id = p_product_id
  limit 1;

  if not found or not v_prod.available then
    raise exception 'product_unavailable';
  end if;

  if v_uid is not null then
    select coalesce(email, '') into v_email from auth.users where id = v_uid;
  end if;

  v_unit_price := round(v_prod.price * (1 - least(100, greatest(0, coalesce(v_prod.discount_percent, 0))) / 100.0));
  v_total := v_unit_price * p_qty;

  insert into public.store_reservations (
    gym_id, product_id, product_name, unit_price, qty, total_price,
    customer_user_id, customer_email, customer_name, customer_phone, note, status
  )
  values (
    p_gym, v_prod.id, v_prod.name, v_unit_price, p_qty, v_total,
    v_uid, v_email, left(v_clean_name, 80), left(trim(p_phone), 20), left(trim(coalesce(p_note, '')), 300), 'new'
  )
  returning id::text into v_res_id;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'unit_price', v_unit_price,
    'total_price', v_total
  );
end;
$$;

-- Customer's Own Reservations History (when signed in with Google on store.html)
create or replace function public.store_my_reservations(p_gym text default 'powergym-main')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id::text,
    'product_name', r.product_name,
    'qty', r.qty,
    'total_price', r.total_price,
    'status', r.status,
    'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  from public.store_reservations r
  where r.gym_id = p_gym
    and r.customer_user_id = (select auth.uid())
    and (select auth.uid()) is not null;
$$;

-- Explicit RPC Execute Grants
revoke execute on function public.pg_claim_or_join_gym(text, text) from public, anon;
grant execute on function public.pg_claim_or_join_gym(text, text) to authenticated;

revoke execute on function public.pg_create_staff_invite(text, text, text) from public, anon;
grant execute on function public.pg_create_staff_invite(text, text, text) to authenticated;

revoke execute on function public.pg_pull_full_state(text) from public, anon;
grant execute on function public.pg_pull_full_state(text) to authenticated;

revoke execute on function public.pg_push_normalized_state(text, jsonb) from public, anon;
grant execute on function public.pg_push_normalized_state(text, jsonb) to authenticated;

grant execute on function public.store_get_info(text) to anon, authenticated;
grant execute on function public.store_reserve(text, text, integer, text, text, text) to anon, authenticated;

revoke execute on function public.store_my_reservations(text) from public, anon;
grant execute on function public.store_my_reservations(text) to authenticated;

revoke execute on function public.store_save_settings(text, text, text, text) from public, anon;
grant execute on function public.store_save_settings(text, text, text, text) to authenticated;

revoke execute on function public.store_upsert_product(text, jsonb) from public, anon;
grant execute on function public.store_upsert_product(text, jsonb) to authenticated;

revoke execute on function public.store_delete_product(text, text) from public, anon;
grant execute on function public.store_delete_product(text, text) to authenticated;

revoke execute on function public.store_list_reservations(text) from public, anon;
grant execute on function public.store_list_reservations(text) to authenticated;

revoke execute on function public.store_set_reservation_status(text, text, text) from public, anon;
grant execute on function public.store_set_reservation_status(text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
