create or replace function public.get_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := public.menu_date()::timestamp at time zone 'America/Sao_Paulo';
  v_end timestamptz := (public.menu_date() + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Acesso administrativo necessário' using errcode = '42501';
  end if;

  -- Pedidos do dia inclui cancelados como volume recebido. Métricas comerciais
  -- usam valid_today: receita, ticket e clientes excluem status cancelled.
  -- O ticket é a média dos total_cents válidos, arredondada para centavos; sem
  -- pedidos válidos, coalesce retorna zero. Os status operacionais abrangem
  -- todos os pedidos ainda ativos, mesmo que tenham sido abertos em outro dia.
  with today_orders as (
    select o.id, o.customer_id, o.status, o.total_cents from public.orders o
    where o.created_at >= v_start and o.created_at < v_end
  ), valid_today as (
    select * from today_orders where status <> 'cancelled'
  ), metrics as (
    select
      (select count(*) from today_orders)::integer as orders_today,
      coalesce((select sum(total_cents) from valid_today), 0)::integer as revenue_today_cents,
      coalesce((select round(avg(total_cents)) from valid_today), 0)::integer as average_ticket_today_cents,
      (select count(distinct customer_id) from valid_today)::integer as customers_today,
      (select count(*) from public.orders where status in ('new','confirmed','preparing','ready','out_for_delivery'))::integer as open_orders
  ), status_counts as (
    select jsonb_build_object(
      'new', count(*) filter (where status = 'new'),
      'confirmed', count(*) filter (where status = 'confirmed'),
      'preparing', count(*) filter (where status = 'preparing'),
      'ready', count(*) filter (where status = 'ready'),
      'out_for_delivery', count(*) filter (where status = 'out_for_delivery')
    ) value from public.orders
    where status in ('new','confirmed','preparing','ready','out_for_delivery')
  ), addon_totals as (
    -- Pré-agregar adicionais por item evita multiplicar quantity e receita
    -- quando um item possui mais de um adicional.
    select a.order_item_id, sum(a.unit_price_cents * a.quantity)::bigint as cents
    from public.order_item_addons a group by a.order_item_id
  ), ranked_products as (
    -- Ranking comercial do dia: snapshot histórico, unidades do item e receita
    -- do produto acrescida dos adicionais; pedidos cancelados não participam.
    select oi.product_name_snapshot as name, sum(oi.quantity)::integer as quantity,
      (sum(oi.unit_price_cents * oi.quantity) + sum(coalesce(at.cents, 0)))::bigint as revenue_cents
    from public.order_items oi join public.orders o on o.id = oi.order_id
    left join addon_totals at on at.order_item_id = oi.id
    where o.created_at >= v_start and o.created_at < v_end and o.status <> 'cancelled'
    group by oi.product_name_snapshot order by quantity desc, revenue_cents desc, name limit 5
  ), recent as (
    select o.id, o.order_number, o.customer_name_snapshot, o.created_at, o.status,
      o.delivery_method, o.total_cents from public.orders o
    order by o.created_at desc, o.id desc limit 8
  )
  select jsonb_build_object(
    'business_date', public.menu_date(), 'metrics', to_jsonb(m), 'status_counts', sc.value,
    'top_products', coalesce((select jsonb_agg(to_jsonb(rp)) from ranked_products rp), '[]'::jsonb),
    'recent_orders', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc) from recent r), '[]'::jsonb),
    'settings', (select jsonb_build_object('name', s.name, 'is_open', s.is_open,
      'delivery_fee_cents', s.delivery_fee_cents, 'delivery_minutes_min', s.delivery_minutes_min,
      'delivery_minutes_max', s.delivery_minutes_max) from public.restaurant_settings s)
  ) into v_result from metrics m cross join status_counts sc;
  return v_result;
end;
$$;

revoke all on function public.get_admin_dashboard() from public, anon, service_role;
grant execute on function public.get_admin_dashboard() to authenticated;
