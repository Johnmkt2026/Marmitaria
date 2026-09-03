-- npx supabase db query --local --file supabase/tests/admin_whatsapp.sql
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_customer uuid := 'ab000000-0000-0000-0000-000000000001';
  v_order uuid;
begin
  begin
    insert into public.customers(id,name,whatsapp_normalized) values(v_customer,'Cliente WhatsApp Teste','11987654321');
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,address_snapshot,subtotal_cents,delivery_fee_cents,total_cents)
      values(v_customer,'new','delivery','pix','Nome Histórico','(11) 98765-4321','Rua Snapshot, 10',2500,600,3100) returning id into v_order;
    insert into public.order_items(order_id,product_name_snapshot,unit_price_cents,quantity,notes)
      values(v_order,'Produto Histórico',1250,2,'Sem cebola');

    perform set_config('role','anon',true);
    assert (select count(*) from public.orders where id=v_order)=0, 'anônimo acessou pedido';
    assert (select count(*) from public.customers where id=v_customer)=0, 'anônimo acessou cliente';

    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
    assert not public.is_admin(), 'usuário de teste não deveria ser admin';
    assert (select count(*) from public.orders where id=v_order)=0, 'não-admin acessou pedido';

    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    assert public.is_admin(), 'admin do seed não reconhecido';
    assert (select count(*) from public.orders where id=v_order)=1, 'admin não acessou pedido';
    assert (select customer_name_snapshot from public.orders where id=v_order)='Nome Histórico', 'snapshot do cliente alterado';
    assert (select whatsapp_snapshot from public.orders where id=v_order)='(11) 98765-4321', 'snapshot do telefone alterado';
    assert (select count(*) from public.order_items where order_id=v_order)=1, 'itens não acessíveis ao admin';

    perform set_config('role','postgres',true);
    raise exception using errcode='ZX001',message='rollback';
  exception when sqlstate 'ZX001' then null; end;
  raise notice 'PASS: RLS administrativa e snapshots do atendimento validados';
end $test$;
