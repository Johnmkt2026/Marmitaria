create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_item_addons_item_idx on public.order_item_addons(order_item_id);

create or replace function public.get_admin_reports(p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer;
  v_start timestamptz;
  v_end timestamptz;
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário' using errcode='42501'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Intervalo inválido'; end if;
  v_days := p_end_date - p_start_date + 1;
  if v_days > 366 then raise exception 'O intervalo máximo é de 366 dias'; end if;
  v_start := p_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_previous_end := v_start;
  v_previous_start := (p_start_date - v_days)::timestamp at time zone 'America/Sao_Paulo';

  with period_orders as (
    select o.*, (o.created_at at time zone 'America/Sao_Paulo')::date business_day,
      extract(hour from o.created_at at time zone 'America/Sao_Paulo')::integer business_hour
    from public.orders o where o.created_at >= v_start and o.created_at < v_end
  ), valid_orders as (select * from period_orders where status <> 'cancelled'),
  previous_valid as (
    select o.total_cents from public.orders o where o.created_at >= v_previous_start
      and o.created_at < v_previous_end and o.status <> 'cancelled'
  ), totals as (
    select count(*)::integer received, count(*) filter(where status <> 'cancelled')::integer valid,
      count(*) filter(where status = 'cancelled')::integer cancelled,
      coalesce(sum(total_cents) filter(where status <> 'cancelled'),0)::bigint revenue,
      count(distinct customer_id) filter(where status <> 'cancelled')::integer customers
    from period_orders
  ), previous_totals as (select coalesce(sum(total_cents),0)::bigint revenue from previous_valid),
  daily_raw as (
    select business_day, count(*)::integer received,
      count(*) filter(where status <> 'cancelled')::integer valid,
      count(*) filter(where status='cancelled')::integer cancelled,
      coalesce(sum(total_cents) filter(where status <> 'cancelled'),0)::bigint revenue
    from period_orders group by business_day
  ), daily as (
    select (p_start_date+g.day_offset)::date date, coalesce(r.received,0) received, coalesce(r.valid,0) valid,
      coalesce(r.cancelled,0) cancelled, coalesce(r.revenue,0) revenue_cents,
      case when coalesce(r.valid,0)=0 then 0 else round(r.revenue::numeric/r.valid)::bigint end average_ticket_cents
    from generate_series(0,v_days-1) g(day_offset) left join daily_raw r on r.business_day=(p_start_date+g.day_offset)::date
  ), payments as (
    select payment_method method, count(*)::integer quantity, sum(total_cents)::bigint revenue_cents
    from valid_orders group by payment_method
  ), methods as (
    select delivery_method method, count(*)::integer quantity, sum(total_cents)::bigint revenue_cents
    from valid_orders group by delivery_method
  ), addon_totals as (
    select a.order_item_id, sum(a.unit_price_cents*a.quantity)::bigint addon_cents
    from public.order_item_addons a join public.order_items oi on oi.id=a.order_item_id
    join valid_orders o on o.id=oi.order_id group by a.order_item_id
  ), products as (
    select oi.product_name_snapshot name, sum(oi.quantity)::integer quantity,
      sum(oi.unit_price_cents*oi.quantity)::bigint product_revenue_cents,
      sum(coalesce(a.addon_cents,0))::bigint addon_revenue_cents
    from public.order_items oi join valid_orders o on o.id=oi.order_id
    left join addon_totals a on a.order_item_id=oi.id group by oi.product_name_snapshot
    order by quantity desc, product_revenue_cents desc, name limit 10
  ), customer_period as (
    select o.customer_id, count(*)::integer orders_count, sum(o.total_cents)::bigint spent_cents,
      exists(select 1 from public.orders old where old.customer_id=o.customer_id
        and old.status<>'cancelled' and old.created_at<v_start) recurring
    from valid_orders o group by o.customer_id
  ), top_customers as (
    select c.id, c.name, cp.orders_count, cp.spent_cents from customer_period cp
    join public.customers c on c.id=cp.customer_id order by cp.spent_cents desc, c.name limit 5
  ), hours as (
    select business_hour hour_of_day, count(*)::integer received,
      coalesce(sum(total_cents) filter(where status<>'cancelled'),0)::bigint revenue_cents
    from period_orders group by business_hour
  )
  select jsonb_build_object(
    'start_date',p_start_date,'end_date',p_end_date,'business_date',public.menu_date(),
    'metrics',jsonb_build_object('revenue_cents',t.revenue,'orders_received',t.received,
      'valid_orders',t.valid,'average_ticket_cents',case when t.valid=0 then 0 else round(t.revenue::numeric/t.valid)::bigint end,
      'unique_customers',t.customers,'cancelled_orders',t.cancelled,
      'cancellation_rate_percent',case when t.received=0 then 0 else round(t.cancelled::numeric*100/t.received,2) end,
      'previous_revenue_cents',pt.revenue,'growth_percent',case when pt.revenue=0 then case when t.revenue=0 then 0 else null end else round((t.revenue-pt.revenue)::numeric*100/pt.revenue,2) end),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.date) from daily d),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('percent',case when t.valid=0 then 0 else round(p.quantity::numeric*100/t.valid,2) end) order by p.method) from payments p),'[]'::jsonb),
    'delivery_methods',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('percent',case when t.valid=0 then 0 else round(m.quantity::numeric*100/t.valid,2) end) order by m.method) from methods m),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('total_revenue_cents',p.product_revenue_cents+p.addon_revenue_cents) order by p.quantity desc,p.product_revenue_cents desc,p.name) from products p),'[]'::jsonb),
    'customers',jsonb_build_object('new',count(*) filter(where not cp.recurring),'recurring',count(*) filter(where cp.recurring),'top',coalesce((select jsonb_agg(to_jsonb(tc) order by tc.spent_cents desc,tc.name) from top_customers tc),'[]'::jsonb)),
    'hours',coalesce((select jsonb_agg(jsonb_build_object('hour',h.hour_of_day,'received',h.received,'revenue_cents',h.revenue_cents) order by h.hour_of_day) from hours h),'[]'::jsonb)
  ) into v_result from totals t cross join previous_totals pt left join customer_period cp on true group by t.revenue,t.received,t.valid,t.customers,t.cancelled,pt.revenue;
  return v_result;
end $$;

revoke all on function public.get_admin_reports(date,date) from public, anon, service_role;
grant execute on function public.get_admin_reports(date,date) to authenticated;
