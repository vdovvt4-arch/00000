-- =========================================================
-- Power Gym — Structured Backend RPC Layer (Supabase)
-- يربط الجداول المهيكلة مع التحقق الأمني من gym_access
-- =========================================================

create or replace function public.pg_sync_structured_snapshot(
  p_gym text,
  p_secret text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean := false;
  v_members_count int := 0;
  v_inv_count int := 0;
  v_sales_count int := 0;
begin
  select exists(
    select 1 from public.gym_access
    where gym_id = p_gym and secret = p_secret
  ) into v_valid;

  if not v_valid then
    raise exception 'Unauthorized gym access';
  end if;

  insert into public.pg_gyms (gym_id, updated_at)
  values (p_gym, now())
  on conflict (gym_id) do update set updated_at = now();

  -- Upsert members
  if jsonb_typeof(p_snapshot->'members') = 'array' then
    insert into public.pg_members (
      gym_id, id, code, name, phone, plan_type, duration_months,
      start_date, end_date, paid_amount, debt_amount, updated_at
    )
    select
      p_gym,
      coalesce(m->>'id', encode(gen_random_bytes(8), 'hex')),
      coalesce(m->>'code', ''),
      coalesce(m->>'name', 'مشترك'),
      coalesce(m->>'phone', ''),
      coalesce(m->>'planType', 'حديد وكارديو'),
      coalesce((m->>'durationMonths')::numeric, 1),
      coalesce((m->>'startDate')::date, current_date),
      coalesce((m->>'endDate')::date, current_date + 30),
      coalesce((m->>'paidAmount')::numeric, 0),
      coalesce((m->>'debtAmount')::numeric, 0),
      now()
    from jsonb_array_elements(p_snapshot->'members') as m
    on conflict (gym_id, id) do update set
      code = excluded.code,
      name = excluded.name,
      phone = excluded.phone,
      plan_type = excluded.plan_type,
      duration_months = excluded.duration_months,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      paid_amount = excluded.paid_amount,
      debt_amount = excluded.debt_amount,
      updated_at = now();

    get diagnostics v_members_count = row_count;
  end if;

  -- Upsert inventory
  if jsonb_typeof(p_snapshot->'inventory') = 'array' then
    insert into public.pg_inventory_items (
      gym_id, id, name, category, sku, qty, min_qty, cost, price, show_in_store, updated_at
    )
    select
      p_gym,
      coalesce(i->>'id', encode(gen_random_bytes(8), 'hex')),
      coalesce(i->>'name', 'منتج'),
      coalesce(i->>'category', 'مكملات'),
      coalesce(i->>'sku', ''),
      coalesce((i->>'qty')::int, 0),
      coalesce((i->>'minQty')::int, 3),
      coalesce((i->>'cost')::numeric, 0),
      coalesce((i->>'price')::numeric, 0),
      coalesce((i->>'showInStore')::boolean, true),
      now()
    from jsonb_array_elements(p_snapshot->'inventory') as i
    on conflict (gym_id, id) do update set
      name = excluded.name,
      category = excluded.category,
      sku = excluded.sku,
      qty = excluded.qty,
      min_qty = excluded.min_qty,
      cost = excluded.cost,
      price = excluded.price,
      show_in_store = excluded.show_in_store,
      updated_at = now();

    get diagnostics v_inv_count = row_count;
  end if;

  -- Upsert sales
  if jsonb_typeof(p_snapshot->'sales') = 'array' then
    insert into public.pg_sales_orders (
      gym_id, id, item_id, item_name, category, qty, unit_price, unit_cost, total, profit, source, sale_date
    )
    select
      p_gym,
      coalesce(s->>'id', encode(gen_random_bytes(8), 'hex')),
      coalesce(s->>'itemId', ''),
      coalesce(s->>'itemName', 'مبيع'),
      coalesce(s->>'category', 'عام'),
      coalesce((s->>'qty')::int, 1),
      coalesce((s->>'unitPrice')::numeric, 0),
      coalesce((s->>'unitCost')::numeric, 0),
      coalesce((s->>'total')::numeric, 0),
      coalesce((s->>'profit')::numeric, 0),
      coalesce(s->>'source', 'pos'),
      coalesce((s->>'date')::date, current_date)
    from jsonb_array_elements(p_snapshot->'sales') as s
    on conflict (gym_id, id) do update set
      qty = excluded.qty,
      total = excluded.total,
      profit = excluded.profit;

    get diagnostics v_sales_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'members_synced', v_members_count,
    'inventory_synced', v_inv_count,
    'sales_synced', v_sales_count,
    'synced_at', now()
  );
end;
$$;

grant execute on function public.pg_sync_structured_snapshot(text, text, jsonb) to anon, authenticated;
