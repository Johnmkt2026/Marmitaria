-- Infraestrutura durável do WhatsApp oficial. Nenhuma chamada externa ocorre no banco.
create type public.whatsapp_conversation_state as enum ('new', 'waiting', 'active', 'resolved');
create type public.whatsapp_message_direction as enum ('inbound', 'outbound');
create type public.whatsapp_message_status as enum ('received', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed');
create type public.whatsapp_outbox_state as enum ('pending', 'processing', 'retry', 'completed', 'dead');

-- Singleton operacional, separado das credenciais Meta e das configurações da loja.
-- Toda instalação começa sem automações; habilitar afeta apenas transições futuras.
create table public.whatsapp_settings (
  singleton boolean primary key default true check (singleton),
  automations_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.whatsapp_settings(singleton,automations_enabled) values(true,false);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text not null check (length(trim(phone_number_id)) between 1 and 100),
  wa_id text not null check (wa_id ~ '^[0-9]{8,20}$'),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,19}$'),
  customer_id uuid references public.customers(id) on delete set null,
  latest_order_id uuid references public.orders(id) on delete set null,
  state public.whatsapp_conversation_state not null default 'new',
  unread_count integer not null default 0 check (unread_count >= 0),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_at timestamptz,
  service_window_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id, wa_id)
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  external_message_id text,
  idempotency_key text not null check (length(idempotency_key) between 1 and 250),
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  direction public.whatsapp_message_direction not null,
  message_type text not null check (message_type in ('text','template','image','document','audio','video','location','interactive','reaction','system','unknown')),
  content_text text check (content_text is null or length(content_text) <= 4096),
  template_name text,
  template_language text,
  template_components jsonb,
  media_id text,
  reply_to_external_message_id text,
  status public.whatsapp_message_status not null,
  automatic boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message text,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key),
  check (
    (direction = 'inbound' and status = 'received')
    or direction = 'outbound'
  )
);
create unique index whatsapp_messages_external_id_uidx
  on public.whatsapp_messages(external_message_id) where external_message_id is not null;

create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.whatsapp_messages(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null check (length(event_type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  state public.whatsapp_outbox_state not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  external_event_key text not null unique check (length(external_event_key) between 1 and 250),
  event_type text not null check (length(event_type) between 1 and 100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index whatsapp_conversations_activity_idx on public.whatsapp_conversations(last_message_at desc nulls last, id);
create index whatsapp_conversations_state_idx on public.whatsapp_conversations(state, last_message_at desc nulls last);
create index whatsapp_messages_conversation_idx on public.whatsapp_messages(conversation_id, created_at desc, id desc);
create index whatsapp_messages_order_idx on public.whatsapp_messages(order_id) where order_id is not null;
create index whatsapp_outbox_claim_idx on public.whatsapp_outbox(next_attempt_at, created_at)
  where state in ('pending', 'retry', 'processing');

create trigger whatsapp_conversations_updated before update on public.whatsapp_conversations
  for each row execute function public.set_updated_at();
create trigger whatsapp_messages_updated before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();
create trigger whatsapp_outbox_updated before update on public.whatsapp_outbox
  for each row execute function public.set_updated_at();
create trigger whatsapp_settings_updated before update on public.whatsapp_settings
  for each row execute function public.set_updated_at();

alter table public.whatsapp_settings enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_outbox enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

create policy "admin whatsapp settings" on public.whatsapp_settings for select to authenticated using (public.is_admin());
create policy "admin update whatsapp settings" on public.whatsapp_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin read whatsapp conversations" on public.whatsapp_conversations
  for select to authenticated using (public.is_admin());
create policy "admin update whatsapp conversations" on public.whatsapp_conversations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin read whatsapp messages" on public.whatsapp_messages
  for select to authenticated using (public.is_admin());
create policy "admin read whatsapp outbox" on public.whatsapp_outbox
  for select to authenticated using (public.is_admin());
create policy "admin read whatsapp webhook events" on public.whatsapp_webhook_events
  for select to authenticated using (public.is_admin());

-- Backend confiável: encontra cliente por telefone normalizado e o pedido mais recente.
create or replace function public.upsert_whatsapp_conversation(
  p_phone_number_id text, p_wa_id text, p_phone_e164 text, p_occurred_at timestamptz default now()
) returns public.whatsapp_conversations
language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid;
  v_customer_matches integer;
  v_order_id uuid;
  v_row public.whatsapp_conversations;
  v_digits text := regexp_replace(p_phone_e164, '[^0-9]', '', 'g');
begin
  if coalesce(trim(p_phone_number_id), '') = '' or p_wa_id !~ '^[0-9]{8,20}$'
    or p_phone_e164 !~ '^\+[1-9][0-9]{7,19}$' then
    raise exception 'Identificação de conversa inválida';
  end if;
  select count(*), (array_agg(c.id order by c.created_at,c.id))[1] into v_customer_matches, v_customer_id from public.customers c
    where regexp_replace(c.whatsapp_normalized, '[^0-9]', '', 'g') = v_digits
       or regexp_replace(c.whatsapp_normalized, '[^0-9]', '', 'g') = regexp_replace(v_digits, '^55', '');
  if v_customer_matches <> 1 then v_customer_id := null; end if;
  if v_customer_id is not null then
    select o.id into v_order_id from public.orders o where o.customer_id = v_customer_id
      order by o.created_at desc, o.id desc limit 1;
    -- Concilia a conversa lógica criada antes do onboarding com o número oficial.
    update public.whatsapp_conversations set phone_number_id=trim(p_phone_number_id), wa_id=p_wa_id,
      phone_e164=p_phone_e164, latest_order_id=coalesce(v_order_id,latest_order_id),
      last_inbound_at=greatest(last_inbound_at,p_occurred_at), last_message_at=greatest(last_message_at,p_occurred_at),
      service_window_expires_at=greatest(service_window_expires_at,p_occurred_at+interval '24 hours')
    where id=(select c.id from public.whatsapp_conversations c where c.customer_id=v_customer_id
      and c.phone_number_id='pending-configuration' order by c.created_at limit 1)
    returning * into v_row;
    if found then return v_row; end if;
  end if;
  insert into public.whatsapp_conversations(phone_number_id, wa_id, phone_e164, customer_id, latest_order_id,
      last_inbound_at, last_message_at, service_window_expires_at)
    values(trim(p_phone_number_id), p_wa_id, p_phone_e164, v_customer_id, v_order_id,
      p_occurred_at, p_occurred_at, p_occurred_at + interval '24 hours')
    on conflict(phone_number_id, wa_id) do update set
      phone_e164 = excluded.phone_e164,
      customer_id = coalesce(public.whatsapp_conversations.customer_id, excluded.customer_id),
      latest_order_id = coalesce(excluded.latest_order_id, public.whatsapp_conversations.latest_order_id),
      last_inbound_at = greatest(public.whatsapp_conversations.last_inbound_at, excluded.last_inbound_at),
      last_message_at = greatest(public.whatsapp_conversations.last_message_at, excluded.last_message_at),
      service_window_expires_at = greatest(public.whatsapp_conversations.service_window_expires_at, excluded.service_window_expires_at)
    returning * into v_row;
  return v_row;
end $$;

create or replace function public.record_whatsapp_inbound(
  p_external_event_key text, p_external_message_id text, p_phone_number_id text,
  p_wa_id text, p_phone_e164 text, p_message_type text, p_content_text text,
  p_occurred_at timestamptz, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_conversation public.whatsapp_conversations; v_message_id uuid;
begin
  insert into public.whatsapp_webhook_events(external_event_key, event_type, payload)
    values(p_external_event_key, 'message', p_payload)
    on conflict(external_event_key) do nothing;
  if not found then
    select m.id into v_message_id from public.whatsapp_messages m where m.external_message_id = p_external_message_id;
    return v_message_id;
  end if;
  v_conversation := public.upsert_whatsapp_conversation(p_phone_number_id, p_wa_id, p_phone_e164, p_occurred_at);
  insert into public.whatsapp_messages(conversation_id, external_message_id, idempotency_key,
    customer_id, order_id, direction, message_type, content_text, status, received_at, raw_event)
  values(v_conversation.id, p_external_message_id, 'inbound:' || p_external_message_id,
    v_conversation.customer_id, v_conversation.latest_order_id, 'inbound', p_message_type,
    left(p_content_text, 4096), 'received', p_occurred_at, p_payload)
  on conflict(external_message_id) where external_message_id is not null do update
    set raw_event = coalesce(public.whatsapp_messages.raw_event, excluded.raw_event)
  returning id into v_message_id;
  update public.whatsapp_conversations set unread_count = unread_count + 1, state = 'new'
    where id = v_conversation.id;
  update public.whatsapp_webhook_events set processed_at = now() where external_event_key = p_external_event_key;
  return v_message_id;
end $$;

create or replace function public.queue_whatsapp_message(
  p_conversation_id uuid, p_content_text text, p_order_id uuid default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_conversation public.whatsapp_conversations; v_message_id uuid; v_key text;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if length(trim(coalesce(p_content_text, ''))) not between 1 and 2000 then
    raise exception 'A mensagem deve conter entre 1 e 2000 caracteres';
  end if;
  select * into v_conversation from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada'; end if;
  if v_conversation.phone_e164 !~ '^\+[1-9][0-9]{7,19}$' then raise exception 'Telefone da conversa inválido'; end if;
  if v_conversation.service_window_expires_at is null or v_conversation.service_window_expires_at <= now() then
    raise exception 'A janela de atendimento de 24 horas está encerrada';
  end if;
  if p_order_id is not null and not exists(select 1 from public.orders o
      where o.id = p_order_id and (v_conversation.customer_id is null or o.customer_id = v_conversation.customer_id)) then
    raise exception 'Pedido não pertence à conversa';
  end if;
  v_key := coalesce(nullif(trim(p_idempotency_key), ''), 'manual:' || gen_random_uuid()::text);
  insert into public.whatsapp_messages(conversation_id, idempotency_key, customer_id, order_id,
    direction, message_type, content_text, status, automatic, created_by)
  values(v_conversation.id, v_key, v_conversation.customer_id, coalesce(p_order_id, v_conversation.latest_order_id),
    'outbound', 'text', trim(p_content_text), 'queued', false, auth.uid())
  returning id into v_message_id;
  insert into public.whatsapp_outbox(message_id, order_id, event_type, payload)
  values(v_message_id, coalesce(p_order_id, v_conversation.latest_order_id), 'manual_message',
    jsonb_build_object('conversation_id', v_conversation.id, 'phone_e164', v_conversation.phone_e164,
      'message_type', 'text', 'content_text', trim(p_content_text)));
  update public.whatsapp_conversations set last_outbound_at = now(), last_message_at = now(), state = 'active'
    where id = v_conversation.id;
  return v_message_id;
end $$;

create or replace function public.update_whatsapp_message_status(
  p_external_event_key text, p_external_message_id text, p_status public.whatsapp_message_status,
  p_occurred_at timestamptz, p_failure_code text default null, p_failure_message text default null,
  p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_current public.whatsapp_message_status; v_rank integer; v_new_rank integer;
begin
  insert into public.whatsapp_webhook_events(external_event_key, event_type, payload)
    values(p_external_event_key, 'status:' || p_status::text, p_payload)
    on conflict(external_event_key) do nothing;
  if not found then return false; end if;
  select status into v_current from public.whatsapp_messages where external_message_id = p_external_message_id for update;
  if not found then
    update public.whatsapp_webhook_events set processed_at=now(), processing_error='Mensagem externa não encontrada'
      where external_event_key=p_external_event_key;
    return false;
  end if;
  v_rank := case v_current when 'queued' then 0 when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 when 'failed' then 5 else -1 end;
  v_new_rank := case p_status when 'queued' then 0 when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 when 'failed' then 5 else -1 end;
  if v_current='read'
    or (p_status='failed' and v_current in ('delivered','read'))
    or (v_current='failed' and p_status not in ('delivered','read'))
    or (v_current<>'failed' and p_status<>'failed' and v_new_rank < v_rank) then
    update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
    return false;
  end if;
  update public.whatsapp_messages set status=p_status,
    accepted_at=case when p_status='accepted' then coalesce(accepted_at,p_occurred_at) else accepted_at end,
    sent_at=case when p_status='sent' then coalesce(sent_at,p_occurred_at) else sent_at end,
    delivered_at=case when p_status='delivered' then coalesce(delivered_at,p_occurred_at) else delivered_at end,
    read_at=case when p_status='read' then coalesce(read_at,p_occurred_at) else read_at end,
    failed_at=case when p_status='failed' then coalesce(failed_at,p_occurred_at) else failed_at end,
    failure_code=case when p_status='failed' then p_failure_code else failure_code end,
    failure_message=case when p_status='failed' then left(p_failure_message,500) else failure_message end
    where external_message_id=p_external_message_id;
  update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
  return true;
end $$;

create or replace function public.claim_whatsapp_outbox(p_worker_id text, p_limit integer default 20)
returns setof public.whatsapp_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(trim(p_worker_id),'')='' then raise exception 'worker_id obrigatório'; end if;
  return query
  with candidates as (
    select o.id from public.whatsapp_outbox o
    where ((o.state in ('pending','retry') and o.next_attempt_at <= now())
      or (o.state='processing' and o.locked_at < now()-interval '5 minutes'))
    order by o.next_attempt_at, o.created_at
    for update skip locked limit least(greatest(p_limit,1),100)
  )
  update public.whatsapp_outbox o set state='processing', locked_at=now(), locked_by=p_worker_id
  from candidates c where o.id=c.id returning o.*;
end $$;

create or replace function public.complete_whatsapp_outbox(p_outbox_id uuid, p_external_message_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_message_id uuid;
begin
  update public.whatsapp_outbox set state='completed', processed_at=now(), locked_at=null, locked_by=null,
    last_error_code=null,last_error_message=null where id=p_outbox_id and state='processing'
    returning message_id into v_message_id;
  if v_message_id is null then raise exception 'Item da outbox não reservado'; end if;
  update public.whatsapp_messages set external_message_id=p_external_message_id, status='accepted', accepted_at=now()
    where id=v_message_id;
end $$;

create or replace function public.fail_whatsapp_outbox(
  p_outbox_id uuid, p_error_code text, p_error_message text, p_retryable boolean, p_max_attempts integer default 5
) returns public.whatsapp_outbox_state
language plpgsql security definer set search_path = '' as $$
declare v_attempt integer; v_state public.whatsapp_outbox_state; v_message_id uuid;
begin
  select attempt_count+1,message_id into v_attempt,v_message_id from public.whatsapp_outbox
    where id=p_outbox_id and state='processing' for update;
  if not found then raise exception 'Item da outbox não reservado'; end if;
  v_state := case when p_retryable and v_attempt < greatest(p_max_attempts,1) then 'retry'::public.whatsapp_outbox_state else 'dead'::public.whatsapp_outbox_state end;
  update public.whatsapp_outbox set state=v_state,attempt_count=v_attempt,
    next_attempt_at=case when v_state='retry' then now()+(power(2,v_attempt)*interval '30 seconds') else next_attempt_at end,
    locked_at=null,locked_by=null,last_error_code=left(p_error_code,100),last_error_message=left(p_error_message,500)
    where id=p_outbox_id;
  if v_state='dead' then update public.whatsapp_messages set status='failed',failed_at=now(),
    failure_code=left(p_error_code,100),failure_message=left(p_error_message,500) where id=v_message_id; end if;
  return v_state;
end $$;

-- Evento lógico de automação. A transação do pedido nunca chama a Meta.
create or replace function public.queue_order_status_whatsapp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conversation public.whatsapp_conversations; v_message_id uuid; v_key text; v_digits text;
begin
  if new.status = old.status or new.status not in ('confirmed','preparing','ready','out_for_delivery','delivered','cancelled') then return new; end if;
  if not coalesce((select s.automations_enabled from public.whatsapp_settings s where s.singleton),false) then return new; end if;
  select c.* into v_conversation from public.whatsapp_conversations c
    where c.customer_id=new.customer_id order by c.last_message_at desc nulls last,c.created_at desc limit 1;
  if not found then
    v_digits := regexp_replace(new.whatsapp_snapshot,'[^0-9]','','g');
    if length(v_digits) in (10,11) then v_digits := '55'||v_digits; end if;
    if v_digits !~ '^[1-9][0-9]{7,19}$' then return new; end if;
    insert into public.whatsapp_conversations(phone_number_id,wa_id,phone_e164,customer_id,latest_order_id,state,last_message_at)
      values('pending-configuration',v_digits,'+'||v_digits,new.customer_id,new.id,'waiting',now())
      on conflict(phone_number_id,wa_id) do update set latest_order_id=excluded.latest_order_id,customer_id=coalesce(public.whatsapp_conversations.customer_id,excluded.customer_id)
      returning * into v_conversation;
  end if;
  v_key := 'order-status:'||new.id::text||':'||new.status::text||':v1';
  insert into public.whatsapp_messages(conversation_id,idempotency_key,customer_id,order_id,direction,
    message_type,template_name,template_language,status,automatic)
  values(v_conversation.id,v_key,new.customer_id,new.id,'outbound','template','order_'||new.status::text,'pt_BR','queued',true)
  on conflict(idempotency_key) do nothing returning id into v_message_id;
  if v_message_id is not null then
    insert into public.whatsapp_outbox(message_id,order_id,event_type,payload)
    values(v_message_id,new.id,'order_status',jsonb_build_object('order_id',new.id,'order_status',new.status,
      'automation_version','v1','template_name','order_'||new.status::text,'template_language','pt_BR',
      'phone_e164',v_conversation.phone_e164,'template_components','[]'::jsonb));
  end if;
  return new;
end $$;
create trigger order_status_whatsapp_outbox after update of status on public.orders
  for each row execute function public.queue_order_status_whatsapp();

revoke all on public.whatsapp_settings, public.whatsapp_conversations, public.whatsapp_messages, public.whatsapp_outbox, public.whatsapp_webhook_events from anon;
revoke all on function public.upsert_whatsapp_conversation(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.record_whatsapp_inbound(text,text,text,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.update_whatsapp_message_status(text,text,public.whatsapp_message_status,timestamptz,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.claim_whatsapp_outbox(text,integer) from public, anon, authenticated;
revoke all on function public.complete_whatsapp_outbox(uuid,text) from public, anon, authenticated;
revoke all on function public.fail_whatsapp_outbox(uuid,text,text,boolean,integer) from public, anon, authenticated;
revoke all on function public.queue_order_status_whatsapp() from public, anon, authenticated;
revoke all on function public.queue_whatsapp_message(uuid,text,uuid,text) from public, anon;
grant execute on function public.queue_whatsapp_message(uuid,text,uuid,text) to authenticated;
grant execute on function public.upsert_whatsapp_conversation(text,text,text,timestamptz),
  public.record_whatsapp_inbound(text,text,text,text,text,text,text,timestamptz,jsonb),
  public.update_whatsapp_message_status(text,text,public.whatsapp_message_status,timestamptz,text,text,jsonb),
  public.claim_whatsapp_outbox(text,integer), public.complete_whatsapp_outbox(uuid,text),
  public.fail_whatsapp_outbox(uuid,text,text,boolean,integer) to service_role;
