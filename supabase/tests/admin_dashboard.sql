-- npx supabase db query --local --file supabase/tests/admin_dashboard.sql
-- Fixtures transacionais para métricas, ranking, timezone e autorização.
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_customer_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_customer_b uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_order_1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_order_2 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_order_3 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_order_cancelled uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_item_1 uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  v_result jsonb;
  v_rejected boolean;
  v_start timestamptz := public.menu_date()::timestamp at time zone 'America/Sao_Paulo';
begin
  begin
    -- Isola as métricas mesmo quando outros testes deixaram pedidos na base;
    -- todo o bloco é revertido pela exceção ZX001 ao final.
    delete from public.orders;
    insert into public.customers(id,name,whatsapp_normalized) values
      (v_customer_a,'Cliente A Dashboard','11999990401'),
      (v_customer_b,'Cliente B Dashboard','11999990402');
    insert into public.orders(id,customer_id,status,delivery_method,payment_method,customer_name_snapshot,
      whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at) values
      (v_order_1,v_customer_a,'delivered','pickup','pix','Cliente A Snapshot','11999990401',3000,0,3000,v_start + interval '10 hours'),
      (v_order_2,v_customer_a,'preparing','delivery','card','Cliente A Snapshot','11999990401',4400,600,5000,v_start + interval '11 hours'),
      (v_order_3,v_customer_b,'new','pickup','cash','Cliente B Snapshot','11999990402',2000,0,2000,v_start + interval '12 hours'),
      (v_order_cancelled,v_customer_b,'cancelled','delivery','pix','Cliente Cancelado','11999990402',9300,600,9900,v_start + interval '13 hours');
    insert into public.order_items(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) values
      (v_item_1,v_order_1,'22222222-2222-2222-2222-222222222201','Nome histórico do produto',1000,2),
      ('cccccccc-cccc-cccc-cccc-ccccccccccc2',v_order_2,'22222222-2222-2222-2222-222222222201','Nome histórico do produto',2000,1),
      ('cccccccc-cccc-cccc-cccc-ccccccccccc3',v_order_3,null,'Produto B',2000,1),
      ('cccccccc-cccc-cccc-cccc-ccccccccccc4',v_order_cancelled,null,'Produto cancelado',930,10);
    insert into public.order_item_addons(order_item_id,addon_name_snapshot,unit_price_cents,quantity)
      values(v_item_1,'Adicional histórico',200,2);
    update public.products set name = 'Nome atual alterado' where id = '22222222-2222-2222-2222-222222222201';

    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    perform set_config('role','authenticated',true);
    v_result := public.get_admin_dashboard();
    assert (v_result->>'business_date')::date = public.menu_date();
    assert (v_result#>>'{metrics,orders_today}')::integer = 4, 'Quantidade do dia incorreta';
    assert (v_result#>>'{metrics,revenue_today_cents}')::integer = 10000, 'Cancelado afetou faturamento';
    assert (v_result#>>'{metrics,average_ticket_today_cents}')::integer = 3333, 'Ticket médio incorreto';
    assert (v_result#>>'{metrics,customers_today}')::integer = 2, 'Clientes únicos incorretos';
    assert (v_result#>>'{metrics,open_orders}')::integer = 2;
    assert (v_result#>>'{status_counts,new}')::integer = 1;
    assert (v_result#>>'{status_counts,preparing}')::integer = 1;
    assert (v_result#>'{top_products,0}'->>'name') = 'Nome histórico do produto';
    assert (v_result#>'{top_products,0}'->>'quantity')::integer = 3;
    assert (v_result#>'{top_products,0}'->>'revenue_cents')::integer = 4400;
    assert not (v_result->'top_products' @> '[{"name":"Produto cancelado"}]'::jsonb);
    assert (v_result#>'{recent_orders,0}'->>'status') = 'cancelled';

    perform set_config('TimeZone','Pacific/Auckland',true);
    v_result := public.get_admin_dashboard();
    assert (v_result->>'business_date')::date = (now() at time zone 'America/Sao_Paulo')::date;
    perform set_config('TimeZone','UTC',true);

    perform set_config('role','postgres',true);
    begin
      delete from public.orders;
      insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,
        whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at) values
        (v_customer_a,'delivered','pickup','pix','Antes do dia','11999990401',100,0,100,v_start - interval '1 microsecond'),
        (v_customer_a,'delivered','pickup','pix','Início do dia','11999990401',100,0,100,v_start),
        (v_customer_a,'delivered','pickup','pix','Fim do dia','11999990401',100,0,100,v_start + interval '1 day' - interval '1 microsecond'),
        (v_customer_a,'delivered','pickup','pix','Próximo dia','11999990401',100,0,100,v_start + interval '1 day');
      perform set_config('role','authenticated',true);
      v_result := public.get_admin_dashboard();
      assert (v_result#>>'{metrics,orders_today}')::integer = 2, 'Limites do dia comercial incorretos';
      assert (v_result#>>'{metrics,revenue_today_cents}')::integer = 200;
      raise exception using errcode='ZX001',message='Restaurar fixtures';
    exception when sqlstate 'ZX001' then null;
    end;

    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
    v_rejected := false;
    begin perform public.get_admin_dashboard(); exception when insufficient_privilege then v_rejected := true; end;
    assert v_rejected, 'Usuário comum consultou o dashboard';
    perform set_config('role','anon',true);
    perform set_config('request.jwt.claim.sub','',true);
    v_rejected := false;
    begin perform public.get_admin_dashboard(); exception when insufficient_privilege then v_rejected := true; end;
    assert v_rejected, 'Anônimo consultou o dashboard';

    perform set_config('role','postgres',true);
    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    begin
      delete from public.orders;
      perform set_config('role','authenticated',true);
      v_result := public.get_admin_dashboard();
      assert (v_result#>>'{metrics,orders_today}')::integer = 0;
      assert (v_result#>>'{metrics,revenue_today_cents}')::integer = 0;
      assert (v_result#>>'{metrics,average_ticket_today_cents}')::integer = 0;
      assert jsonb_array_length(v_result->'top_products') = 0;
      raise exception using errcode='ZX001',message='Restaurar fixtures';
    exception when sqlstate 'ZX001' then null;
    end;

    perform set_config('role','postgres',true);
    begin
      delete from public.orders;
      insert into public.orders(id,customer_id,status,delivery_method,payment_method,customer_name_snapshot,
        whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_order_cancelled,v_customer_b,'cancelled','delivery','pix','Somente Cancelado','11999990402',9300,600,9900,v_start + interval '13 hours');
      insert into public.order_items(order_id,product_name_snapshot,unit_price_cents,quantity)
      values(v_order_cancelled,'Produto cancelado',930,10);
      perform set_config('role','authenticated',true);
      v_result := public.get_admin_dashboard();
      assert (v_result#>>'{metrics,orders_today}')::integer = 1;
      assert (v_result#>>'{metrics,revenue_today_cents}')::integer = 0;
      assert (v_result#>>'{metrics,average_ticket_today_cents}')::integer = 0;
      assert (v_result#>>'{metrics,customers_today}')::integer = 0;
      assert jsonb_array_length(v_result->'top_products') = 0;
      raise exception using errcode='ZX001',message='Restaurar fixtures';
    exception when sqlstate 'ZX001' then null;
    end;

    perform set_config('role','postgres',true);
    raise exception using errcode='ZX001',message='Restaurar dados após teste';
  exception when sqlstate 'ZX001' then null;
  end;
  raise notice 'PASS: pedidos=4, faturamento=10000, ticket=3333, clientes=2, abertos=2; cancelado excluído do comercial';
end $test$;
