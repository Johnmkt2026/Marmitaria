-- Uma única instrução para compatibilidade com supabase db query --file.
do $test$
declare
  result jsonb;
  o public.orders;
  i public.order_items;
  a public.order_item_addons;
  items jsonb;
  rejected boolean;
  before_orders integer;
  before_customers integer;
  good_items jsonb := '[{"product_id":"22222222-2222-2222-2222-222222222201","quantity":2,"addon_ids":["44444444-4444-4444-4444-444444444401"],"notes":"Sem cebola"}]';
begin
  perform set_config('role', 'anon', true);
  result := public.create_order('Cliente Teste RPC', '+5511999990101', 'delivery', 'pix', 'Rua de Teste, 120', 'Homologação direta da RPC', good_items);
  perform set_config('role', 'postgres', true);
  select * into strict o from public.orders where id = (result->>'order_id')::uuid;
  select * into strict i from public.order_items where order_id = o.id;
  select * into strict a from public.order_item_addons where order_item_id = i.id;
  assert i.unit_price_cents = 2490 and i.quantity = 2 and i.notes = 'Sem cebola';
  assert i.product_name_snapshot = 'Frango grelhado';
  assert a.unit_price_cents = 200 and a.quantity = 2 and a.addon_name_snapshot = 'Ovo frito';
  assert o.subtotal_cents = i.unit_price_cents * i.quantity + a.unit_price_cents * a.quantity;
  assert o.subtotal_cents = 5380 and o.delivery_fee_cents = 600 and o.total_cents = 5980;
  assert (result->>'total_cents')::integer = o.total_cents and (result->>'order_number')::bigint = o.order_number;
  assert (select count(*) from public.order_status_history where order_id = o.id and status = 'new') = 1;
  update public.products set name = 'Nome novo após venda', price_cents = 9999 where id = i.product_id;
  assert (select product_name_snapshot = 'Frango grelhado' and unit_price_cents = 2490 from public.order_items where id = i.id),
    'Alterar o produto modificou o snapshot histórico do pedido';
  update public.products set name = 'Frango grelhado', price_cents = 2490 where id = i.product_id;
  -- Visitantes não leem pedidos/dados pessoais nem escrevem diretamente no catálogo.
  perform set_config('role', 'anon', true);
  assert (select count(*) from public.orders) = 0;
  assert (select count(*) from public.order_items) = 0;
  assert (select count(*) from public.order_item_addons) = 0;
  assert (select count(*) from public.order_status_history) = 0;
  assert (select count(*) from public.customers) = 0;
  assert (select count(*) from public.admin_users) = 0;
  rejected := false;
  begin
    insert into public.categories(name) values ('Escrita anônima proibida');
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
  perform set_config('role', 'authenticated', true);
  assert not public.is_admin();
  assert (select count(*) from public.orders) = 0;
  assert (select count(*) from public.order_item_addons) = 0;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb', true);
  perform set_config('role', 'authenticated', true);
  assert public.is_admin();
  assert (select count(*) from public.orders where id = o.id) = 1;
  assert (select count(*) from public.order_items where id = i.id) = 1;
  assert (select count(*) from public.order_item_addons where id = a.id) = 1;
  assert (select count(*) from public.order_status_history where order_id = o.id) = 1;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  -- A data comercial não depende do timezone da conexão.
  perform set_config('TimeZone', 'Pacific/Auckland', true);
  assert public.menu_date() = (now() at time zone 'America/Sao_Paulo')::date;
  perform set_config('TimeZone', 'UTC', true);
  begin
    update public.categories set active = false;
    perform set_config('role', 'anon', true);
    assert (select count(*) from public.products) = 0;
    assert (select count(*) from public.product_options) = 0;
    assert (select count(*) from public.product_addons) = 0;
    assert (select count(*) from public.product_daily_availability) = 0;
    raise exception using errcode = 'ZX001', message = 'Restaurar fixture';
  exception when sqlstate 'ZX001' then null;
  end;
  select count(*) into before_orders from public.orders;
  select count(*) into before_customers from public.customers;
  for items in select value from jsonb_array_elements('[null,{},[],[{"quantity":2}],
    [{"product_id":"inválido","quantity":2}],
    [{"product_id":"22222222-2222-2222-2222-222222222201","quantity":0}],
    [{"product_id":"22222222-2222-2222-2222-222222222201","quantity":1.5}],
    [{"product_id":"22222222-2222-2222-2222-222222222204","quantity":1}],
    [{"product_id":"22222222-2222-2222-2222-222222222201","quantity":2,"addon_ids":["44444444-4444-4444-4444-444444444403"]}],
    [{"product_id":"22222222-2222-2222-2222-222222222201","quantity":2,"addon_ids":["inválido"]}],
    [{"product_id":"22222222-2222-2222-2222-222222222201","quantity":2,"addon_ids":["44444444-4444-4444-4444-444444444401","44444444-4444-4444-4444-444444444401"]}]]') loop
    rejected := false;
    begin
      perform public.create_order('Cliente inválido', '11999990102', 'delivery', 'pix', 'Rua Teste, 20', '', items);
    exception when others then rejected := true;
    end;
    assert rejected, 'RPC aceitou dados inválidos';
    assert (select count(*) from public.orders) = before_orders;
    assert (select count(*) from public.customers) = before_customers;
  end loop;
  -- Cada alteração temporária é revertida após verificar a rejeição.
  for items in select to_jsonb(value) from unnest(array[
    'update public.products set active = false',
    'update public.categories set active = false',
    'update public.product_addons set active = false',
    'update public.product_daily_availability set available_today = false',
    'update public.product_daily_availability set sold_out = true',
    'delete from public.product_daily_availability',
    'update public.restaurant_settings set is_open = false',
    'delete from public.restaurant_settings',
    'update public.product_options set max_choices = 0'
  ]) as value loop
    begin
      execute items #>> '{}';
      rejected := false;
      begin
        perform public.create_order('Cliente inválido', '11999990102', 'delivery', 'pix', 'Rua Teste, 20', '', good_items);
      exception when others then rejected := true;
      end;
      assert rejected, 'RPC aceitou configuração indisponível';
      raise exception using errcode = 'ZX001', message = 'Restaurar fixture';
    exception when sqlstate 'ZX001' then null;
    end;
  end loop;
  -- Preços forjados não alteram valores obtidos do catálogo pelo banco.
  begin
    result := public.create_order('Cliente Preço Forjado', '11999990104', 'delivery', 'pix', 'Rua Teste, 20', '',
      jsonb_set(good_items, '{0}', good_items->0 || '{"price_cents":1,"unit_price_cents":1,"total_cents":1}'));
    assert (result->>'subtotal_cents')::integer = 5380 and (result->>'total_cents')::integer = 5980;
    raise exception using errcode = 'ZX001', message = 'Restaurar fixture';
  exception when sqlstate 'ZX001' then null;
  end;
  -- Retirada não cobra entrega.
  begin
    result := public.create_order('Cliente Retirada', '11999990103', 'pickup', 'cash', null, '', good_items, 10000);
    assert (result->>'delivery_fee_cents')::integer = 0 and (result->>'total_cents')::integer = 5380;
    assert (select change_for_cents from public.orders where id = (result->>'order_id')::uuid) = 10000;
    raise exception using errcode = 'ZX001', message = 'Restaurar fixture';
  exception when sqlstate 'ZX001' then null;
  end;
  raise notice 'PASS: pedido %, subtotal 5380, entrega 600, total 5980; adicional quantity=2; rejeições e retirada validadas', o.order_number;
end $test$;
