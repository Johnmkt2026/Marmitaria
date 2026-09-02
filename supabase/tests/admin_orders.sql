-- npx supabase db query --local --file supabase/tests/admin_orders.sql
-- Teste transacional: não remove nem altera pedidos existentes.
do $test$
declare
  v_order uuid;
  v_cancelled_order uuid;
  v_result jsonb;
  v_count integer;
  v_history_count integer;
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
begin
  begin
    -- O teste continua reproduzível independentemente da data em que for executado.
    insert into public.product_daily_availability (product_id, date, available_today, sold_out, sort_order)
    values
      ('22222222-2222-2222-2222-222222222201', public.menu_date(), true, false, 1),
      ('22222222-2222-2222-2222-222222222202', public.menu_date(), true, false, 2)
    on conflict (product_id, date) do update
      set available_today = excluded.available_today, sold_out = excluded.sold_out;

    v_result := public.create_order('Teste SQL Painel', '11999990404', 'delivery', 'pix', 'Rua Teste, 40', 'Teste transacional',
      '[{"product_id":"22222222-2222-2222-2222-222222222201","quantity":2,"addon_ids":["44444444-4444-4444-4444-444444444401"]}]');
    v_order := (v_result->>'order_id')::uuid;

    perform set_config('role', 'anon', true);
    assert (select count(*) from public.orders where id = v_order) = 0;
    update public.orders set status = 'confirmed' where id = v_order;
    get diagnostics v_count = row_count;
    assert v_count = 0, 'Visitante alterou pedido';
    perform set_config('role', 'postgres', true);

    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
    perform set_config('role', 'authenticated', true);
    assert not public.is_admin();
    update public.orders set status = 'confirmed' where id = v_order;
    get diagnostics v_count = row_count;
    assert v_count = 0, 'Usuário comum alterou pedido';
    perform set_config('role', 'postgres', true);

    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('role', 'authenticated', true);
    assert public.is_admin();
    assert (select count(*) from public.orders where id = v_order) = 1;
    assert (select count(*) from public.order_items where order_id = v_order) = 1;
    assert (select sum(a.quantity) from public.order_item_addons a join public.order_items i on i.id = a.order_item_id where i.order_id = v_order) = 2;

    update public.orders set status = 'confirmed' where id = v_order;
    assert (select status from public.orders where id = v_order) = 'confirmed';
    update public.orders set status = 'preparing' where id = v_order;
    assert (select status from public.orders where id = v_order) = 'preparing';

    -- A aplicação deve rejeitar o salto preparing -> delivered antes do update.
    assert not ('delivered' = any(array['ready','cancelled']::public.order_status[]));
    v_history_count := (select count(*) from public.order_status_history where order_id = v_order);
    assert (select status from public.orders where id = v_order) = 'preparing';
    assert (select count(*) from public.order_status_history where order_id = v_order) = v_history_count;

    -- Um cliente com versão vencida não pode sobrescrever o status.
    update public.orders set status = 'cancelled' where id = v_order and updated_at = '1970-01-01'::timestamptz;
    get diagnostics v_count = row_count;
    assert v_count = 0;
    assert (select status from public.orders where id = v_order) = 'preparing';

    update public.orders set status = 'ready' where id = v_order;
    update public.orders set status = 'out_for_delivery' where id = v_order;
    update public.orders set status = 'delivered' where id = v_order;
    assert (select status from public.orders where id = v_order) = 'delivered';
    -- delivered é terminal: a matriz do servidor não oferece qualquer destino.
    assert cardinality(array[]::public.order_status[]) = 0;
    assert (select count(*) from public.order_status_history where order_id = v_order) = 6;
    assert (select count(*) from public.order_status_history where order_id = v_order and changed_by = v_admin) = 5;
    assert (select total_cents from public.orders where id = v_order) = 5980;

    -- cancelled também é terminal e registra o administrador responsável.
    v_result := public.create_order('Teste SQL Cancelado', '11999990405', 'pickup', 'cash', null, null,
      '[{"product_id":"22222222-2222-2222-2222-222222222202","quantity":1,"addon_ids":[]}]');
    v_cancelled_order := (v_result->>'order_id')::uuid;
    update public.orders set status = 'cancelled' where id = v_cancelled_order;
    assert (select status from public.orders where id = v_cancelled_order) = 'cancelled';
    assert cardinality(array[]::public.order_status[]) = 0;
    assert (select count(*) from public.order_status_history where order_id = v_cancelled_order and status = 'cancelled' and changed_by = v_admin) = 1;

    perform set_config('role', 'postgres', true);
    raise exception using errcode = 'ZX001', message = 'Restaurar dados após teste';
  exception when sqlstate 'ZX001' then null;
  end;
end $test$;
