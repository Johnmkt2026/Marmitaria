-- npx supabase db query --local --file supabase/tests/whatsapp_messaging.sql
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_customer uuid := gen_random_uuid();
  v_order uuid;
  v_conversation public.whatsapp_conversations;
  v_inbound uuid;
  v_manual uuid;
  v_automatic uuid;
  v_outbox public.whatsapp_outbox;
  v_state public.whatsapp_outbox_state;
  v_denied boolean := false;
  v_customer_without_chat uuid := gen_random_uuid();
  v_order_without_chat uuid;
  v_ambiguous_a uuid := gen_random_uuid();
  v_ambiguous_b uuid := gen_random_uuid();
  v_ambiguous_conversation public.whatsapp_conversations;
  v_window_expires timestamptz;
  v_cursor_id uuid;
  v_cursor_created_at timestamptz;
begin
  begin
    insert into public.customers(id,name,whatsapp_normalized) values(v_customer,'Cliente Mensageria','11987654321');
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,
      subtotal_cents,delivery_fee_cents,total_cents)
    values(v_customer,'new','pickup','pix','Cliente Snapshot','(11) 98765-4321',1234,0,1234) returning id into v_order;

    v_conversation := public.upsert_whatsapp_conversation('phone-local','5511987654321','+5511987654321','2026-09-20T12:00:00Z');
    assert v_conversation.customer_id=v_customer, 'telefone conhecido não vinculou customer';
    assert v_conversation.latest_order_id=v_order, 'pedido recente não vinculado';
    perform public.upsert_whatsapp_conversation('phone-local','5511000000000','+5511000000000','2026-09-20T12:00:00Z');
    assert (select customer_id is null from public.whatsapp_conversations where wa_id='5511000000000'), 'telefone desconhecido vinculou customer';
    insert into public.customers(id,name,whatsapp_normalized) values
      (v_ambiguous_a,'Cliente Ambíguo A','31987654321'),(v_ambiguous_b,'Cliente Ambíguo B','5531987654321');
    v_ambiguous_conversation := public.upsert_whatsapp_conversation('phone-local','5531987654321','+5531987654321',now());
    assert v_ambiguous_conversation.customer_id is null, 'telefone ambíguo escolheu cliente arbitrariamente';

    v_inbound := public.record_whatsapp_inbound('event:message:1','wamid.in.1','phone-local','5511987654321',
      '+5511987654321','text','Boa tarde, meu pedido já saiu?','2026-09-20T12:01:00Z','{"test":true}'::jsonb);
    perform public.record_whatsapp_inbound('event:message:1','wamid.in.1','phone-local','5511987654321',
      '+5511987654321','text','duplicada','2026-09-20T12:01:00Z','{"test":true}'::jsonb);
    assert (select count(*) from public.whatsapp_messages where external_message_id='wamid.in.1')=1, 'inbound duplicado';
    assert (select unread_count from public.whatsapp_conversations where id=v_conversation.id)=1, 'unread_count duplicado';
    assert (select service_window_expires_at='2026-09-21T12:01:00Z'::timestamptz from public.whatsapp_conversations where id=v_conversation.id), 'janela de atendimento incorreta';
    select service_window_expires_at into v_window_expires from public.whatsapp_conversations where id=v_conversation.id;

    perform set_config('role','anon',true);
    assert not has_table_privilege('anon','public.whatsapp_settings','SELECT,INSERT,UPDATE,DELETE'), 'anon recebeu privilégio em settings';
    assert not has_table_privilege('anon','public.whatsapp_conversations','SELECT,INSERT,UPDATE,DELETE'), 'anon recebeu privilégio em conversations';
    assert not has_table_privilege('anon','public.whatsapp_messages','SELECT,INSERT,UPDATE,DELETE'), 'anon recebeu privilégio em messages';
    assert not has_table_privilege('anon','public.whatsapp_outbox','SELECT,INSERT,UPDATE,DELETE'), 'anon recebeu privilégio em outbox';
    assert not has_table_privilege('anon','public.whatsapp_webhook_events','SELECT,INSERT,UPDATE,DELETE'), 'anon recebeu privilégio em events';
    begin perform count(*) from public.whatsapp_conversations; raise exception 'anon acessou conversas'; exception when insufficient_privilege then null; end;
    begin perform count(*) from public.whatsapp_messages; raise exception 'anon acessou mensagens'; exception when insufficient_privilege then null; end;
    begin perform count(*) from public.whatsapp_outbox; raise exception 'anon acessou outbox'; exception when insufficient_privilege then null; end;
    begin perform count(*) from public.whatsapp_webhook_events; raise exception 'anon acessou webhooks'; exception when insufficient_privilege then null; end;

    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
    assert not public.is_admin(), 'usuário comum reconhecido como admin';
    assert (select count(*) from public.whatsapp_conversations)=0, 'não-admin acessou conversas';
    assert (select count(*) from public.whatsapp_messages)=0, 'não-admin acessou mensagens';
    assert (select count(*) from public.whatsapp_outbox)=0, 'não-admin acessou outbox';
    assert (select count(*) from public.whatsapp_webhook_events)=0, 'não-admin acessou eventos';
    begin
      perform public.queue_whatsapp_message(v_conversation.id,'sem acesso',v_order,'manual:denied');
    exception when others then v_denied := true; end;
    assert v_denied, 'não-admin enfileirou mensagem';
    v_denied := false;
    begin
      perform public.record_whatsapp_inbound('denied','wamid.denied','phone-local','5511999999999','+5511999999999','text','negado',now(),'{}');
    exception when others then v_denied := true; end;
    assert v_denied, 'não-admin chamou RPC interna privilegiada';

    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    assert public.is_admin(), 'admin não reconhecido';
    assert (select count(*) from public.whatsapp_conversations)>=2, 'admin não acessou conversas';
    assert (select not automations_enabled from public.whatsapp_settings where singleton), 'automação não iniciou desligada';
    v_manual := public.queue_whatsapp_message(v_conversation.id,'Resposta local',v_order,'manual:test:1');
    assert (select status='queued' and not automatic from public.whatsapp_messages where id=v_manual), 'mensagem manual inválida';
    assert (select count(*) from public.whatsapp_outbox where message_id=v_manual)=1, 'outbox manual ausente';
    assert (select service_window_expires_at=v_window_expires from public.whatsapp_conversations where id=v_conversation.id), 'outbound estendeu janela de atendimento';
    begin
      perform public.queue_whatsapp_message(v_conversation.id,'duplicada',v_order,'manual:test:1');
      raise exception 'idempotency_key duplicada aceita';
    exception when unique_violation then null; end;

    update public.orders set status='confirmed' where id=v_order;
    assert not exists(select 1 from public.whatsapp_messages where idempotency_key='order-status:'||v_order::text||':confirmed:v1'), 'automação desligada criou mensagem';
    assert not exists(select 1 from public.whatsapp_outbox where order_id=v_order and event_type='order_status'), 'automação desligada criou outbox';
    update public.whatsapp_settings set automations_enabled=true where singleton;
    assert not exists(select 1 from public.whatsapp_messages where idempotency_key='order-status:'||v_order::text||':confirmed:v1'), 'ativação criou backlog histórico';
    update public.orders set status='preparing' where id=v_order;
    select id into v_automatic from public.whatsapp_messages where idempotency_key='order-status:'||v_order::text||':preparing:v1';
    assert v_automatic is not null, 'nova transição após ativação não criou mensagem lógica';
    assert (select automatic and template_name='order_preparing' from public.whatsapp_messages where id=v_automatic), 'template automático inválido';
    update public.orders set notes='não recriar automação' where id=v_order;
    assert (select count(*) from public.whatsapp_messages where idempotency_key='order-status:'||v_order::text||':preparing:v1')=1, 'automação duplicada';

    insert into public.customers(id,name,whatsapp_normalized) values(v_customer_without_chat,'Cliente Sem Chat','21987654321');
    insert into public.orders(customer_id,status,delivery_method,payment_method,customer_name_snapshot,whatsapp_snapshot,
      subtotal_cents,delivery_fee_cents,total_cents) values(v_customer_without_chat,'new','pickup','pix','Cliente Sem Chat',
      '(21) 98765-4321',1000,0,1000) returning id into v_order_without_chat;
    update public.orders set status='confirmed' where id=v_order_without_chat;
    assert exists(select 1 from public.whatsapp_conversations where customer_id=v_customer_without_chat and phone_number_id='pending-configuration'), 'transição sem conversa não criou conversa lógica';
    assert exists(select 1 from public.whatsapp_messages where idempotency_key='order-status:'||v_order_without_chat::text||':confirmed:v1'), 'transição sem conversa não criou evento idempotente';

    perform set_config('role','service_role',true);
    select * into v_outbox from public.claim_whatsapp_outbox('worker-test',1) limit 1;
    assert v_outbox.id is not null and v_outbox.state='processing', 'claim não reservou item';
    v_state := public.fail_whatsapp_outbox(v_outbox.id,'http_500','temporário',true,3);
    assert v_state='retry', 'falha temporária não agendada para retry';
    assert (select attempt_count=1 and next_attempt_at>now() from public.whatsapp_outbox where id=v_outbox.id), 'backoff não persistido';
    update public.whatsapp_outbox set next_attempt_at=now() where id=v_outbox.id;
    update public.whatsapp_outbox set next_attempt_at=now()+interval '1 day' where id<>v_outbox.id and state in ('pending','retry');
    select * into v_outbox from public.claim_whatsapp_outbox('worker-test',1) where id=v_outbox.id;
    perform public.complete_whatsapp_outbox(v_outbox.id,'wamid.out.1');
    assert (select state='completed' from public.whatsapp_outbox where id=v_outbox.id), 'outbox não completada';
    assert (select status='accepted' from public.whatsapp_messages where external_message_id='wamid.out.1'), 'mensagem não aceita';

    assert public.update_whatsapp_message_status('event:sent','wamid.out.1','sent','2026-09-20T12:02:00Z',null,null,'{}');
    assert public.update_whatsapp_message_status('event:delivered','wamid.out.1','delivered','2026-09-20T12:03:00Z',null,null,'{}');
    assert public.update_whatsapp_message_status('event:read','wamid.out.1','read','2026-09-20T12:04:00Z',null,null,'{}');
    assert not public.update_whatsapp_message_status('event:late-sent','wamid.out.1','sent','2026-09-20T12:05:00Z',null,null,'{}'), 'evento atrasado regrediu status';
    assert not public.update_whatsapp_message_status('event:late-failed','wamid.out.1','failed','2026-09-20T12:06:00Z','late','atrasado','{}'), 'failed atrasado sobrescreveu read';
    assert not public.update_whatsapp_message_status('event:read','wamid.out.1','read','2026-09-20T12:04:00Z',null,null,'{}'), 'evento duplicado processado';
    assert (select status='read' and read_at is not null from public.whatsapp_messages where external_message_id='wamid.out.1'), 'status final incorreto';

    insert into public.whatsapp_messages(conversation_id,external_message_id,idempotency_key,direction,message_type,content_text,status,failed_at)
      values(v_conversation.id,'wamid.failed.then.delivered','failed-then-delivered','outbound','text','teste','failed',now());
    assert public.update_whatsapp_message_status('event:failed-then-delivered','wamid.failed.then.delivered','delivered',now(),null,null,'{}'), 'delivered posterior não superou failed';
    assert (select status='delivered' from public.whatsapp_messages where external_message_id='wamid.failed.then.delivered'), 'failed permaneceu após evidência de entrega';

    insert into public.whatsapp_messages(conversation_id,idempotency_key,direction,message_type,content_text,status,created_at)
      select v_conversation.id,'paging:'||g::text,'outbound','text','página '||g::text,'queued','2026-09-19T10:00:00Z'::timestamptz
      from generate_series(1,51) g;
    select id,created_at into v_cursor_id,v_cursor_created_at from public.whatsapp_messages
      where idempotency_key like 'paging:%' order by created_at desc,id desc offset 49 limit 1;
    assert (select count(*) from public.whatsapp_messages where idempotency_key like 'paging:%'
      and (created_at<v_cursor_created_at or (created_at=v_cursor_created_at and id<v_cursor_id)))=1,
      'cursor timestamp+uuid perdeu ou duplicou mensagem';

    update public.whatsapp_outbox set next_attempt_at=now() where state in ('pending','retry');
    select * into v_outbox from public.claim_whatsapp_outbox('worker-test-failure',1) limit 1;
    v_state := public.fail_whatsapp_outbox(v_outbox.id,'http_400','falha permanente',false,5);
    assert v_state='dead', 'falha permanente não foi para dead';
    assert (select status='failed' and failed_at is not null from public.whatsapp_messages where id=v_outbox.message_id), 'mensagem falha não atualizada';

    perform set_config('role','postgres',true);
    raise exception using errcode='ZX001',message='rollback';
  exception when sqlstate 'ZX001' then null; end;
  raise notice 'PASS: mensageria WhatsApp, RLS, idempotência, automação e retry validados';
end $test$;
