-- npx supabase db query --local --file supabase/tests/admin_reports.sql
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_a uuid := 'a1000000-0000-0000-0000-000000000001';
  v_b uuid := 'a1000000-0000-0000-0000-000000000002';
  v_start_date date := public.menu_date()-2;
  v_end_date date := public.menu_date();
  v_start timestamptz := (public.menu_date()-2)::timestamp at time zone 'America/Sao_Paulo';
  v_result jsonb; v_rejected boolean; v_o1 uuid; v_o2 uuid;
begin
  begin
    delete from public.orders;
    insert into public.customers(id,name,whatsapp_normalized) values(v_a,'Cliente Relatório A','11999990601'),(v_b,'Cliente Relatório B','11999990602');
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_a,'delivered','pickup','pix','A histórico','11999990601',5000,0,5000,v_start-interval '1 day') returning id into v_o1;
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_b,'cancelled','pickup','pix','B cancelado anterior','11999990602',7777,0,7777,v_start-interval '2 days');
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_a,'delivered','pickup','pix','A histórico','11999990601',3000,0,3000,v_start+interval '10 hours') returning id into v_o1;
    insert into public.order_items(order_id,product_name_snapshot,unit_price_cents,quantity) values(v_o1,'Produto snapshot',1000,2) returning id into v_o2;
    insert into public.order_item_addons(order_item_id,addon_name_snapshot,unit_price_cents,quantity) values(v_o2,'Adicional snapshot',200,2);
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_a,'preparing','delivery','card','A histórico','11999990601',4400,600,5000,v_start+interval '2 days 11 hours') returning id into v_o2;
    insert into public.order_items(order_id,product_name_snapshot,unit_price_cents,quantity) values(v_o2,'Produto snapshot',2000,1);
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_b,'new','pickup','cash','B histórico','11999990602',2000,0,2000,v_start+interval '2 days 12 hours') returning id into v_o2;
    insert into public.order_items(order_id,product_name_snapshot,unit_price_cents,quantity) values(v_o2,'Produto B',2000,1);
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at)
      values(v_b,'cancelled','delivery','pix','Cancelado','11999990602',9300,600,9900,v_start+interval '2 days 13 hours') returning id into v_o2;
    insert into public.order_items(order_id,product_name_snapshot,unit_price_cents,quantity) values(v_o2,'Produto cancelado',930,10);

    perform set_config('request.jwt.claim.sub',v_admin::text,true); perform set_config('role','authenticated',true);
    v_result:=public.get_admin_reports(v_start_date,v_end_date);
    assert (v_result#>>'{metrics,orders_received}')::int=4;
    assert (v_result#>>'{metrics,valid_orders}')::int=3;
    assert (v_result#>>'{metrics,revenue_cents}')::int=10000;
    assert (v_result#>>'{metrics,average_ticket_cents}')::int=3333;
    assert (v_result#>>'{metrics,unique_customers}')::int=2;
    assert (v_result#>>'{metrics,cancelled_orders}')::int=1;
    assert (v_result#>>'{metrics,cancellation_rate_percent}')::numeric=25;
    assert (v_result#>>'{metrics,previous_revenue_cents}')::int=5000;
    assert (v_result#>>'{metrics,growth_percent}')::numeric=100;
    assert jsonb_array_length(v_result->'daily')=3 and (v_result#>>'{daily,1,received}')::int=0;
    assert (v_result#>>'{products,0,name}')='Produto snapshot' and (v_result#>>'{products,0,quantity}')::int=3;
    assert (v_result#>>'{products,0,product_revenue_cents}')::int=4000 and (v_result#>>'{products,0,addon_revenue_cents}')::int=400;
    assert not(v_result->'products' @> '[{"name":"Produto cancelado"}]');
    assert (v_result#>>'{customers,new}')::int=1 and (v_result#>>'{customers,recurring}')::int=1;
    assert (v_result#>>'{customers,top,0,spent_cents}')::int=8000;
    assert (select sum((x->>'quantity')::int) from jsonb_array_elements(v_result->'payments') x)=3;
    assert (select sum((x->>'quantity')::int) from jsonb_array_elements(v_result->'delivery_methods') x)=3;
    assert (select round(sum((x->>'percent')::numeric),2) from jsonb_array_elements(v_result->'payments') x)=99.99;
    assert (select (x->>'quantity')::int from jsonb_array_elements(v_result->'payments') x where x->>'method'='pix')=1;
    assert (select (x->>'quantity')::int from jsonb_array_elements(v_result->'delivery_methods') x where x->>'method'='pickup')=2;
    assert (select (x->>'received')::int from jsonb_array_elements(v_result->'hours') x where (x->>'hour')::int=13)=1;
    assert (select (x->>'revenue_cents')::int from jsonb_array_elements(v_result->'hours') x where (x->>'hour')::int=13)=0;

    perform set_config('TimeZone','Pacific/Auckland',true);v_result:=public.get_admin_reports(v_start_date,v_end_date);
    assert (v_result#>>'{metrics,revenue_cents}')::int=10000 and (v_result#>>'{daily,0,date}')::date=v_start_date and (v_result#>>'{daily,2,date}')::date=v_end_date;perform set_config('TimeZone','UTC',true);
    v_rejected:=false;begin perform public.get_admin_reports(v_end_date,v_start_date);exception when others then v_rejected:=true;end;assert v_rejected;
    v_rejected:=false;begin perform public.get_admin_reports(v_start_date-400,v_end_date);exception when others then v_rejected:=true;end;assert v_rejected;
    perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);v_rejected:=false;begin perform public.get_admin_reports(v_start_date,v_end_date);exception when insufficient_privilege then v_rejected:=true;end;assert v_rejected;
    perform set_config('role','anon',true);perform set_config('request.jwt.claim.sub','',true);v_rejected:=false;begin perform public.get_admin_reports(v_start_date,v_end_date);exception when insufficient_privilege then v_rejected:=true;end;assert v_rejected;
    perform set_config('role','postgres',true);perform set_config('request.jwt.claim.sub',v_admin::text,true);
    begin delete from public.orders;perform set_config('role','authenticated',true);v_result:=public.get_admin_reports(v_start_date,v_end_date);assert (v_result#>>'{metrics,orders_received}')::int=0 and (v_result#>>'{metrics,revenue_cents}')::int=0;assert (v_result#>>'{metrics,growth_percent}')::numeric=0 and jsonb_array_length(v_result->'daily')=3;raise exception using errcode='ZX001',message='rollback';exception when sqlstate 'ZX001' then null;end;
    perform set_config('role','postgres',true);
    begin
      delete from public.orders;
      insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at) values
        (v_a,'delivered','pickup','pix','Antes','11999990601',100,0,100,v_start-interval '3 days 1 microsecond'),
        (v_a,'delivered','pickup','pix','Início','11999990601',100,0,100,v_start),
        (v_a,'delivered','pickup','pix','Fim','11999990601',100,0,100,((v_end_date+1)::timestamp at time zone 'America/Sao_Paulo')-interval '1 microsecond'),
        (v_a,'delivered','pickup','pix','Depois','11999990601',100,0,100,(v_end_date+1)::timestamp at time zone 'America/Sao_Paulo');
      perform set_config('role','authenticated',true);v_result:=public.get_admin_reports(v_start_date,v_end_date);
      assert (v_result#>>'{metrics,orders_received}')::int=2 and (v_result#>>'{metrics,revenue_cents}')::int=200;
      assert (v_result#>'{metrics,growth_percent}')='null'::jsonb;
      raise exception using errcode='ZX001',message='rollback';exception when sqlstate 'ZX001' then null;
    end;
    perform set_config('role','postgres',true);raise exception using errcode='ZX001',message='rollback';
  exception when sqlstate 'ZX001' then null;end;
  raise notice 'PASS: recebidos=4 válidos=3 receita=10000 ticket=3333 cancelamento=25%% crescimento=100%%';
end $test$;
