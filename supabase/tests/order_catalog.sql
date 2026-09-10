-- npx supabase db query --local --file supabase/tests/order_catalog.sql
do $test$
declare
  v_meal uuid := '22222222-2222-2222-2222-222222222201';
  v_beverage uuid := '22222222-2222-2222-2222-222222222205';
  v_addon uuid := '44444444-4444-4444-4444-444444444401';
  v_result jsonb; v_order uuid; v_item public.order_items; v_before integer; v_rejected boolean;
begin
  update public.restaurant_settings set is_open=true,delivery_fee_cents=600;
  update public.products set name='Prato do dia 1',public_name='Prato do dia',product_type='meal',price_cents=2200,small_price_cents=2200,large_price_cents=3000,active=true where id=v_meal;
  update public.products set name='Coca-Cola 350ml',public_name='Coca-Cola 350ml',product_type='beverage',price_cents=600,active=true where id=v_beverage;
  update public.product_addons set price_cents=200,active=true where id=v_addon;
  insert into public.product_daily_availability(product_id,date,available_today,sold_out,sort_order)
  values(v_meal,public.menu_date(),true,false,1) on conflict(product_id,date) do update set available_today=true,sold_out=false;

  v_result:=public.create_order('Cliente Catálogo','11999990011','delivery','pix','Rua Teste, 10',null,
    jsonb_build_array(
      jsonb_build_object('product_id',v_meal,'size','large','quantity',2,'addon_ids',jsonb_build_array(v_addon),'notes','Sem cebola','unit_price_cents',1,'total_cents',1),
      jsonb_build_object('product_id',v_beverage,'quantity',1,'addon_ids','[]'::jsonb)
    ));
  v_order:=(v_result->>'order_id')::uuid;
  assert (v_result->>'subtotal_cents')::integer=7000 and (v_result->>'delivery_fee_cents')::integer=600 and (v_result->>'total_cents')::integer=7600, 'Total delivery incorreto';
  select * into strict v_item from public.order_items where order_id=v_order and product_id=v_meal;
  assert v_item.product_name_snapshot='Prato do dia 1' and v_item.public_name_snapshot='Prato do dia' and v_item.size_snapshot='large' and v_item.unit_price_cents=3000 and v_item.quantity=2, 'Snapshot da refeição incorreto';
  assert (select quantity=2 and unit_price_cents=200 from public.order_item_addons where order_item_id=v_item.id), 'Adicional não multiplicou a quantidade';
  assert (select size_snapshot is null and unit_price_cents=600 and public_name_snapshot='Coca-Cola 350ml' from public.order_items where order_id=v_order and product_id=v_beverage), 'Snapshot da bebida incorreto';
  assert v_result->'items'->0 ? 'unit_price_cents' and jsonb_array_length(v_result->'items')=2, 'Retorno não contém itens reais';

  update public.categories set active=false where id=(select category_id from public.products where id=v_beverage);
  v_result:=public.create_order('Cliente Bebida','11999990018','pickup','pix',null,null,
    jsonb_build_array(jsonb_build_object('product_id',v_beverage,'quantity',1,'addon_ids','[]'::jsonb)));
  assert (v_result->>'total_cents')::integer=600, 'Bebida ativa dependeu da categoria ou disponibilidade diária';
  update public.categories set active=true where id=(select category_id from public.products where id=v_beverage);

  update public.products set name='Prato do dia Especial',public_name='Outro nome',large_price_cents=3500 where id=v_meal;
  assert (select product_name_snapshot='Prato do dia 1' and public_name_snapshot='Prato do dia' and size_snapshot='large' and unit_price_cents=3000 from public.order_items where id=v_item.id), 'Histórico mudou com o catálogo';

  v_result:=public.create_order('Cliente Retirada','11999990012','pickup','cash',null,null,
    jsonb_build_array(jsonb_build_object('product_id',v_meal,'size','small','quantity',1,'addon_ids','[]'::jsonb)));
  assert (v_result->>'subtotal_cents')::integer=2200 and (v_result->>'delivery_fee_cents')::integer=0 and (v_result->>'total_cents')::integer=2200, 'Retirada pequena incorreta';

  select count(*) into v_before from public.orders;
  foreach v_result in array array[
    jsonb_build_array(jsonb_build_object('product_id',v_meal,'quantity',1,'addon_ids','[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('product_id',v_meal,'size','gigante','quantity',1,'addon_ids','[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('product_id',v_beverage,'size','small','quantity',1,'addon_ids','[]'::jsonb))
  ] loop
    v_rejected:=false;
    begin perform public.create_order('Cliente Inválido','11999990013','pickup','pix',null,null,v_result); exception when others then v_rejected:=true; end;
    assert v_rejected, 'Payload inválido foi aceito';
  end loop;
  assert (select count(*) from public.orders)=v_before, 'Falha deixou escrita parcial';

  update public.products set active=false where id=v_beverage;
  v_rejected:=false; begin perform public.create_order('Cliente Inválido','11999990014','pickup','pix',null,null,jsonb_build_array(jsonb_build_object('product_id',v_beverage,'quantity',1))); exception when others then v_rejected:=true; end; assert v_rejected,'Bebida inativa aceita';
  update public.products set active=true where id=v_beverage;
  update public.product_daily_availability set sold_out=true where product_id=v_meal and date=public.menu_date();
  v_rejected:=false; begin perform public.create_order('Cliente Inválido','11999990015','pickup','pix',null,null,jsonb_build_array(jsonb_build_object('product_id',v_meal,'size','small','quantity',1))); exception when others then v_rejected:=true; end; assert v_rejected,'Esgotado aceito';
  update public.product_daily_availability set sold_out=false,available_today=false where product_id=v_meal and date=public.menu_date();
  v_rejected:=false; begin perform public.create_order('Cliente Inválido','11999990016','pickup','pix',null,null,jsonb_build_array(jsonb_build_object('product_id',v_meal,'size','small','quantity',1))); exception when others then v_rejected:=true; end; assert v_rejected,'Prato fora do dia aceito';
  update public.restaurant_settings set is_open=false;
  v_rejected:=false; begin perform public.create_order('Cliente Inválido','11999990017','pickup','pix',null,null,jsonb_build_array(jsonb_build_object('product_id',v_beverage,'quantity',1))); exception when others then v_rejected:=true; end; assert v_rejected,'Restaurante fechado aceitou pedido';

  raise exception using errcode='ZX001',message='Restaur dados';
exception when sqlstate 'ZX001' then null;
end $test$;
