-- npx supabase db query --local --file supabase/tests/admin_settings.sql
-- Teste transacional: leitura pública, escrita administrativa, integridade e efeito na RPC.
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_settings_id uuid := '00000000-0000-0000-0000-000000000001';
  v_count integer;
  v_rejected boolean;
  v_result jsonb;
  v_items jsonb := '[{"product_id":"22222222-2222-2222-2222-222222222201","quantity":1,"addon_ids":[]}]';
begin
  begin
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('role', 'authenticated', true);
    assert public.is_admin();
    assert (select count(*) from public.restaurant_settings where id = v_settings_id) = 1;

    v_rejected := false;
    begin
      insert into public.restaurant_settings(name) values ('Segunda configuração');
    exception when unique_violation then v_rejected := true;
    end;
    assert v_rejected, 'Uma segunda configuração do restaurante foi aceita';

    update public.restaurant_settings
       set name = 'Marmitaria Configuração Teste',
           is_open = true,
           delivery_fee_cents = 850,
           delivery_minutes_min = 40,
           delivery_minutes_max = 60
     where id = v_settings_id;
    assert (select delivery_fee_cents = 850 and delivery_minutes_min = 40 and delivery_minutes_max = 60
              from public.restaurant_settings where id = v_settings_id);

    update public.restaurant_settings set name = 'Versão vencida'
     where id = v_settings_id and updated_at = '1970-01-01'::timestamptz;
    get diagnostics v_count = row_count;
    assert v_count = 0, 'Controle de concorrência aceitou versão vencida';

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('role', 'anon', true);
    assert (select name from public.restaurant_settings where id = v_settings_id) = 'Marmitaria Configuração Teste';
    update public.restaurant_settings set delivery_fee_cents = 1 where id = v_settings_id;
    get diagnostics v_count = row_count;
    assert v_count = 0, 'Visitante alterou configurações';

    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
    perform set_config('role', 'authenticated', true);
    assert not public.is_admin();
    update public.restaurant_settings set delivery_fee_cents = 1 where id = v_settings_id;
    get diagnostics v_count = row_count;
    assert v_count = 0, 'Usuário não administrador alterou configurações';

    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claim.sub', '', true);
    v_rejected := false;
    begin
      update public.restaurant_settings set delivery_fee_cents = -1 where id = v_settings_id;
    exception when check_violation then v_rejected := true;
    end;
    assert v_rejected, 'Taxa negativa foi aceita';

    v_rejected := false;
    begin
      update public.restaurant_settings set delivery_minutes_min = -1 where id = v_settings_id;
    exception when check_violation then v_rejected := true;
    end;
    assert v_rejected, 'Prazo negativo foi aceito';

    v_rejected := false;
    begin
      update public.restaurant_settings set delivery_minutes_min = 61, delivery_minutes_max = 60 where id = v_settings_id;
    exception when check_violation then v_rejected := true;
    end;
    assert v_rejected, 'Prazo máximo menor que o mínimo foi aceito';

    update public.restaurant_settings set is_open = false where id = v_settings_id;
    v_rejected := false;
    begin
      perform public.create_order('Cliente Fechado', '11999990201', 'delivery', 'pix', 'Rua Teste, 10', '', v_items);
    exception when others then
      v_rejected := sqlerrm = 'Restaurante fechado';
    end;
    assert v_rejected, 'RPC aceitou pedido com a marmitaria fechada';

    update public.restaurant_settings set is_open = true, delivery_fee_cents = 850 where id = v_settings_id;
    v_result := public.create_order('Cliente Entrega Config', '11999990202', 'delivery', 'pix', 'Rua Teste, 20', '', v_items);
    assert (v_result->>'delivery_fee_cents')::integer = 850;
    assert (select delivery_fee_cents from public.orders where id = (v_result->>'order_id')::uuid) = 850;

    v_result := public.create_order('Cliente Retirada Config', '11999990203', 'pickup', 'cash', null, '', v_items);
    assert (v_result->>'delivery_fee_cents')::integer = 0;
    assert (select delivery_fee_cents from public.orders where id = (v_result->>'order_id')::uuid) = 0;

    perform set_config('role', 'postgres', true);
    raise exception using errcode = 'ZX001', message = 'Restaurar dados após teste';
  exception when sqlstate 'ZX001' then null;
  end;
  raise notice 'PASS: RLS, concorrência, constraints, fechamento e taxas delivery=850/pickup=0 validados';
end $test$;
