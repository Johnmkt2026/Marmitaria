-- npx supabase db query --local --file supabase/tests/product_catalog.sql
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_category uuid;
  v_meal uuid := gen_random_uuid();
  v_beverage uuid := gen_random_uuid();
  v_rejected boolean := false;
begin
  select id into v_category from public.categories order by sort_order limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.products(id, category_id, name, public_name, product_type, description, price_cents, small_price_cents, large_price_cents, sort_order)
  values(v_meal, v_category, 'Prato do dia 1', 'Prato do dia', 'meal', 'Teste', 2000, 2000, 2500,
    coalesce((select max(sort_order) + 1 from public.products), 0));
  assert (select product_type = 'meal' and name = 'Prato do dia 1' and public_name = 'Prato do dia'
    and price_cents = 2000 and small_price_cents = 2000 and large_price_cents = 2500 from public.products where id = v_meal);

  insert into public.products(id, category_id, name, public_name, product_type, price_cents, sort_order)
  values(v_beverage, v_category, 'Coca-Cola 350ml', 'Coca-Cola 350ml', 'beverage', 600,
    coalesce((select max(sort_order) + 1 from public.products), 0));
  assert (select product_type = 'beverage' and price_cents = 600 and small_price_cents is null and large_price_cents is null from public.products where id = v_beverage);

  begin
    update public.products set small_price_cents = null where id = v_meal;
  exception when check_violation then v_rejected := true;
  end;
  assert v_rejected, 'Refeição sem os dois preços foi aceita';

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
  update public.products set public_name = 'Alterado' where id = v_meal;
  assert not found, 'Anônimo alterou produto';

  perform set_config('role', 'postgres', true);
  raise exception using errcode='ZX001', message='Restaurar dados após teste';
exception when sqlstate 'ZX001' then null;
end $test$;
