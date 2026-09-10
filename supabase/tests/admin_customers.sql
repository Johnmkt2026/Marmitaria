-- npx supabase db query --local --file supabase/tests/admin_customers.sql
-- Teste transacional: valida agregações e RLS sem deixar fixtures no banco.
do $test$
declare
  v_customer uuid;
  v_first uuid;
  v_cancelled uuid;
  v_result jsonb;
  v_count integer;
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
begin
  begin
    insert into public.product_daily_availability (product_id, date, available_today, sold_out, sort_order)
    values
      ('22222222-2222-2222-2222-222222222201', public.menu_date(), true, false, 1),
      ('22222222-2222-2222-2222-222222222202', public.menu_date(), true, false, 2)
    on conflict (product_id, date) do update set available_today = true, sold_out = false;

    v_result := public.create_order('Cliente Teste CRM', '11999990601', 'delivery', 'pix', 'Rua CRM, 10', null,
      '[{"product_id":"22222222-2222-2222-2222-222222222201","size":"small","quantity":2,"addon_ids":["44444444-4444-4444-4444-444444444401"]}]');
    v_first := (v_result->>'order_id')::uuid;
    perform public.create_order('Cliente Teste CRM', '11999990601', 'pickup', 'cash', null, null,
      '[{"product_id":"22222222-2222-2222-2222-222222222202","size":"small","quantity":1,"addon_ids":[]}]');
    v_result := public.create_order('Cliente Teste CRM', '11999990601', 'delivery', 'card', 'Rua CRM, 10', null,
      '[{"product_id":"22222222-2222-2222-2222-222222222201","size":"small","quantity":1,"addon_ids":[]}]');
    v_cancelled := (v_result->>'order_id')::uuid;
    select customer_id into v_customer from public.orders where id = v_first;
    update public.orders set status = 'cancelled' where id = v_cancelled;
    assert (select count(*) from public.orders where customer_id = v_customer and status <> 'cancelled') = 2;
    assert (select sum(total_cents) from public.orders where customer_id = v_customer and status <> 'cancelled') = 8970;
    assert round((select avg(total_cents) from public.orders where customer_id = v_customer and status <> 'cancelled')) = 4485;
    assert (select first_order_at from public.customers where id = v_customer) =
      (select min(created_at) from public.orders where customer_id = v_customer and status <> 'cancelled');
    assert (select last_order_at from public.customers where id = v_customer) =
      (select max(created_at) from public.orders where customer_id = v_customer and status <> 'cancelled');
    assert (select count(*) from public.customer_addresses where customer_id = v_customer) = 1;
    assert (select address_line from public.customer_addresses where customer_id = v_customer) = 'Rua CRM, 10';
    assert (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.customer_id = v_customer) = 3;

    perform set_config('role', 'anon', true);
    assert (select count(*) from public.customers where id = v_customer) = 0;
    assert (select count(*) from public.customer_addresses where customer_id = v_customer) = 0;
    perform set_config('role', 'postgres', true);

    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
    perform set_config('role', 'authenticated', true);
    assert not public.is_admin();
    assert (select count(*) from public.customers where id = v_customer) = 0;
    assert (select count(*) from public.orders where customer_id = v_customer) = 0;
    perform set_config('role', 'postgres', true);

    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('role', 'authenticated', true);
    assert public.is_admin();
    select count(*) into v_count from public.customers where id = v_customer;
    assert v_count = 1;

    perform set_config('role', 'postgres', true);
    raise exception using errcode = 'ZX001', message = 'Restaurar dados após teste';
  exception when sqlstate 'ZX001' then null;
  end;
end $test$;
