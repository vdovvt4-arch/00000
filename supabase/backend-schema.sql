-- =========================================================
-- Power Gym — Structured Relational Backend Schema (Supabase / PostgreSQL)
-- Version: 3.0.0
-- Security: RLS enabled + anon direct access revoked (RPC SECURITY DEFINER only)
-- =========================================================

create extension if not exists pgcrypto;

-- 1. القاعات المسجلة
create table if not exists public.pg_gyms (
  gym_id text primary key,
  gym_name text not null default 'Power Gym | بور جم',
  branch text not null default '',
  schema_version integer not null default 3,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. المشتركون والاشتراكات
create table if not exists public.pg_members (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  code text not null default '',
  name text not null,
  phone text not null default '',
  plan_type text not null default 'حديد وكارديو',
  duration_months numeric(4,2) not null default 1,
  start_date date not null,
  end_date date not null,
  paid_amount numeric(12,2) not null default 0,
  debt_amount numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_members_phone on public.pg_members (gym_id, phone);
create index if not exists idx_pg_members_end_date on public.pg_members (gym_id, end_date);

-- 3. المخزن والمتجر
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
  show_in_store boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_inventory_category on public.pg_inventory_items (gym_id, category);

-- 4. المبيعات والطلبات
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
  created_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_sales_date on public.pg_sales_orders (gym_id, sale_date desc);

-- 5. سجل الحضور
create table if not exists public.pg_attendance_logs (
  gym_id text not null references public.pg_gyms(gym_id) on delete cascade,
  id text not null,
  member_id text not null,
  member_name text not null default '',
  check_in_date date not null default current_date,
  check_in_at timestamptz not null default now(),
  primary key (gym_id, id)
);

create index if not exists idx_pg_attendance_date on public.pg_attendance_logs (gym_id, check_in_date desc);

-- 6. تفعيل Row Level Security ومنع الوصول المباشر للمجهولين
alter table public.pg_gyms enable row level security;
alter table public.pg_members enable row level security;
alter table public.pg_inventory_items enable row level security;
alter table public.pg_sales_orders enable row level security;
alter table public.pg_attendance_logs enable row level security;

revoke all on table public.pg_gyms from anon, authenticated;
revoke all on table public.pg_members from anon, authenticated;
revoke all on table public.pg_inventory_items from anon, authenticated;
revoke all on table public.pg_sales_orders from anon, authenticated;
revoke all on table public.pg_attendance_logs from anon, authenticated;
