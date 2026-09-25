-- Suporte passivo e idempotente aos webhooks oficiais de coexistência.
-- Esta migration não inicia onboarding, sincronização nem envio externo.

create type public.whatsapp_message_origin as enum ('cloud_api', 'business_app', 'history');
create type public.whatsapp_sync_type as enum ('history', 'contacts');
create type public.whatsapp_sync_state as enum ('pending', 'processing', 'completed', 'failed');
create type public.whatsapp_connection_state as enum ('not_configured', 'connected', 'coexistence_active', 'attention', 'removed');

alter table public.whatsapp_messages
  add column message_origin public.whatsapp_message_origin not null default 'cloud_api';

alter table public.whatsapp_settings
  add column connection_state public.whatsapp_connection_state not null default 'not_configured',
  add column business_account_id text,
  add column business_phone_number text,
  add column last_account_event text,
  add column disconnection_reason text,
  add column disconnection_initiated_by text,
  add column connection_updated_at timestamptz;

alter table public.whatsapp_webhook_events
  add column field text not null default 'messages',
  add column origin public.whatsapp_message_origin,
  add column external_batch_key text;

create table public.whatsapp_sync_runs (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text not null check (length(trim(phone_number_id)) between 1 and 100),
  sync_type public.whatsapp_sync_type not null,
  external_batch_id text not null check (length(trim(external_batch_id)) between 1 and 250),
  state public.whatsapp_sync_state not null default 'pending',
  phase text,
  progress integer check (progress between 0 and 100),
  items_processed integer not null default 0 check (items_processed >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id, sync_type, external_batch_id)
);

create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text not null check (length(trim(phone_number_id)) between 1 and 100),
  wa_id text not null check (wa_id ~ '^[0-9]{8,20}$'),
  display_name text check (display_name is null or length(display_name) <= 250),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,19}$'),
  customer_id uuid references public.customers(id) on delete set null,
  source text not null default 'business_app' check (source = 'business_app'),
  source_updated_at timestamptz not null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id, wa_id)
);

create index whatsapp_messages_origin_idx on public.whatsapp_messages(message_origin, created_at desc, id desc);
create index whatsapp_sync_runs_activity_idx on public.whatsapp_sync_runs(sync_type, updated_at desc, id desc);
create index whatsapp_contacts_customer_idx on public.whatsapp_contacts(customer_id) where customer_id is not null;

create trigger whatsapp_sync_runs_updated before update on public.whatsapp_sync_runs
  for each row execute function public.set_updated_at();
create trigger whatsapp_contacts_updated before update on public.whatsapp_contacts
  for each row execute function public.set_updated_at();

alter table public.whatsapp_sync_runs enable row level security;
alter table public.whatsapp_contacts enable row level security;

create policy "admin read whatsapp sync runs" on public.whatsapp_sync_runs
  for select to authenticated using (public.is_admin());
create policy "admin read whatsapp contacts" on public.whatsapp_contacts
  for select to authenticated using (public.is_admin());

create or replace function public.match_whatsapp_customer(p_phone_e164 text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_digits text := regexp_replace(coalesce(p_phone_e164,''), '[^0-9]', '', 'g'); v_count integer; v_id uuid;
begin
  select count(*), (array_agg(c.id order by c.created_at,c.id))[1] into v_count,v_id
  from public.customers c
  where regexp_replace(c.whatsapp_normalized,'[^0-9]','','g')=v_digits
     or regexp_replace(c.whatsapp_normalized,'[^0-9]','','g')=regexp_replace(v_digits,'^55','');
  return case when v_count=1 then v_id else null end;
end $$;

create or replace function public.upsert_whatsapp_passive_conversation(
  p_phone_number_id text, p_wa_id text, p_phone_e164 text, p_occurred_at timestamptz,
  p_origin public.whatsapp_message_origin, p_direction public.whatsapp_message_direction
) returns public.whatsapp_conversations
language plpgsql security definer set search_path = '' as $$
declare v_customer_id uuid; v_order_id uuid; v_row public.whatsapp_conversations;
begin
  if coalesce(trim(p_phone_number_id),'')='' or p_wa_id !~ '^[0-9]{8,20}$'
     or p_phone_e164 !~ '^\+[1-9][0-9]{7,19}$' or p_origin not in ('history','business_app') then
    raise exception 'Identificação passiva inválida';
  end if;
  v_customer_id := public.match_whatsapp_customer(p_phone_e164);
  if v_customer_id is not null then
    select o.id into v_order_id from public.orders o where o.customer_id=v_customer_id
      order by o.created_at desc,o.id desc limit 1;
  end if;

  select c.* into v_row from public.whatsapp_conversations c
    where c.phone_number_id=trim(p_phone_number_id) and c.wa_id=p_wa_id for update;
  if found then
    update public.whatsapp_conversations set
      phone_e164=p_phone_e164,
      customer_id=coalesce(customer_id,v_customer_id),
      latest_order_id=coalesce(v_order_id,latest_order_id),
      last_message_at=greatest(last_message_at,p_occurred_at),
      last_outbound_at=case when p_origin='business_app' and p_direction='outbound' then greatest(last_outbound_at,p_occurred_at) else last_outbound_at end,
      state=case when p_origin='business_app' and state='resolved' then 'active'::public.whatsapp_conversation_state else state end
    where id=v_row.id returning * into v_row;
    return v_row;
  end if;

  if v_customer_id is not null then
    update public.whatsapp_conversations set
      phone_number_id=trim(p_phone_number_id),wa_id=p_wa_id,phone_e164=p_phone_e164,
      latest_order_id=coalesce(v_order_id,latest_order_id),
      last_message_at=greatest(last_message_at,p_occurred_at),
      last_outbound_at=case when p_origin='business_app' and p_direction='outbound' then greatest(last_outbound_at,p_occurred_at) else last_outbound_at end,
      state=case when p_origin='business_app' then 'active'::public.whatsapp_conversation_state else state end
    where id=(select c.id from public.whatsapp_conversations c where c.customer_id=v_customer_id
      and c.phone_number_id='pending-configuration' order by c.created_at limit 1)
    returning * into v_row;
    if found then return v_row; end if;
  end if;

  insert into public.whatsapp_conversations(phone_number_id,wa_id,phone_e164,customer_id,latest_order_id,
    state,unread_count,last_outbound_at,last_message_at)
  values(trim(p_phone_number_id),p_wa_id,p_phone_e164,v_customer_id,v_order_id,
    case when p_origin='business_app' then 'active'::public.whatsapp_conversation_state else 'resolved'::public.whatsapp_conversation_state end,
    0,case when p_origin='business_app' and p_direction='outbound' then p_occurred_at end,p_occurred_at)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.record_whatsapp_passive_message(
  p_external_event_key text, p_external_message_id text, p_phone_number_id text,
  p_wa_id text, p_phone_e164 text, p_direction public.whatsapp_message_direction,
  p_origin public.whatsapp_message_origin, p_message_type text, p_content_text text,
  p_status public.whatsapp_message_status, p_occurred_at timestamptz, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_conversation public.whatsapp_conversations; v_message_id uuid;
begin
  if p_origin not in ('history','business_app')
     or (p_origin='business_app' and p_direction<>'outbound')
     or (p_direction='inbound' and p_status<>'received') then raise exception 'Mensagem passiva inválida'; end if;
  insert into public.whatsapp_webhook_events(external_event_key,event_type,field,origin,payload)
    values(p_external_event_key,'message:'||p_origin::text,
      case when p_origin='history' then 'history' else 'smb_message_echoes' end,p_origin,p_payload)
    on conflict(external_event_key) do nothing;
  if not found then select m.id into v_message_id from public.whatsapp_messages m where m.external_message_id=p_external_message_id; return v_message_id; end if;
  select m.id into v_message_id from public.whatsapp_messages m where m.external_message_id=p_external_message_id;
  if found then
    if p_origin='business_app' then
      v_conversation := public.upsert_whatsapp_passive_conversation(p_phone_number_id,p_wa_id,p_phone_e164,p_occurred_at,p_origin,p_direction);
      update public.whatsapp_messages set
        conversation_id=v_conversation.id,customer_id=v_conversation.customer_id,order_id=v_conversation.latest_order_id,
        direction='outbound',message_origin='business_app',automatic=false,
        message_type=case when message_type='unknown' and p_message_type in ('text','image','document','audio','video','location','interactive','reaction','system') then p_message_type else message_type end,
        content_text=case when coalesce(content_text,'')='' and coalesce(p_content_text,'')<>'' then left(p_content_text,4096) else content_text end,
        status=case when status in ('received','queued','accepted') then 'sent'::public.whatsapp_message_status else status end,
        sent_at=coalesce(sent_at,p_occurred_at),raw_event=coalesce(p_payload,raw_event)
      where id=v_message_id;
    elsif p_origin='history' then
      update public.whatsapp_messages set
        message_type=case when message_type='unknown' and p_message_type in ('text','image','document','audio','video','location','interactive','reaction','system') then p_message_type else message_type end,
        content_text=case when coalesce(content_text,'')='' and coalesce(p_content_text,'')<>'' then left(p_content_text,4096) else content_text end,
        status=case when message_origin='business_app' and
          (case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 0 else -1 end) >
          (case status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 0 else -1 end)
          then p_status else status end,
        delivered_at=case when message_origin='business_app' and p_status in ('delivered','read') then coalesce(delivered_at,p_occurred_at) else delivered_at end,
        read_at=case when message_origin='business_app' and p_status='read' then coalesce(read_at,p_occurred_at) else read_at end,
        raw_event=coalesce(p_payload,raw_event)
      where id=v_message_id;
    end if;
    update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
    return v_message_id;
  end if;
  v_conversation := public.upsert_whatsapp_passive_conversation(p_phone_number_id,p_wa_id,p_phone_e164,p_occurred_at,p_origin,p_direction);
  insert into public.whatsapp_messages(conversation_id,external_message_id,idempotency_key,customer_id,order_id,
    direction,message_origin,message_type,content_text,status,automatic,received_at,sent_at,delivered_at,read_at,failed_at,raw_event,created_at)
  values(v_conversation.id,p_external_message_id,p_origin::text||':'||p_external_message_id,
    v_conversation.customer_id,v_conversation.latest_order_id,p_direction,p_origin,
    case when p_message_type in ('text','template','image','document','audio','video','location','interactive','reaction','system','unknown') then p_message_type else 'unknown' end,
    left(coalesce(p_content_text,''),4096),p_status,false,
    case when p_direction='inbound' then p_occurred_at end,
    case when p_direction='outbound' and p_status in ('sent','delivered','read') then p_occurred_at end,
    case when p_direction='outbound' and p_status in ('delivered','read') then p_occurred_at end,
    case when p_direction='outbound' and p_status='read' then p_occurred_at end,
    case when p_direction='outbound' and p_status='failed' then p_occurred_at end,
    p_payload,p_occurred_at) returning id into v_message_id;
  update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
  return v_message_id;
end $$;

create or replace function public.record_whatsapp_sync_progress(
  p_external_event_key text, p_phone_number_id text, p_sync_type public.whatsapp_sync_type,
  p_external_batch_id text, p_state public.whatsapp_sync_state, p_phase text,
  p_progress integer, p_items_processed integer, p_failure_code text, p_failure_message text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.whatsapp_webhook_events(external_event_key,event_type,field,external_batch_key,payload)
    values(p_external_event_key,'sync:'||p_sync_type::text,
      case when p_sync_type='history' then 'history' else 'smb_app_state_sync' end,p_external_batch_id,p_payload)
    on conflict(external_event_key) do nothing;
  if not found then
    select r.id into v_id from public.whatsapp_sync_runs r where r.phone_number_id=p_phone_number_id
      and r.sync_type=p_sync_type and r.external_batch_id=p_external_batch_id;
    return v_id;
  end if;
  insert into public.whatsapp_sync_runs(phone_number_id,sync_type,external_batch_id,state,phase,progress,
    items_processed,completed_at,failure_code,failure_message)
  values(trim(p_phone_number_id),p_sync_type,trim(p_external_batch_id),p_state,nullif(trim(p_phase),''),p_progress,
    greatest(p_items_processed,0),case when p_state in ('completed','failed') then now() end,
    left(p_failure_code,100),left(p_failure_message,500))
  on conflict(phone_number_id,sync_type,external_batch_id) do update set
    state=case
      when public.whatsapp_sync_runs.state in ('completed','failed') then public.whatsapp_sync_runs.state
      when excluded.state in ('completed','failed') then excluded.state
      else 'processing'::public.whatsapp_sync_state end,
    phase=coalesce(excluded.phase,public.whatsapp_sync_runs.phase),
    progress=case
      when public.whatsapp_sync_runs.progress is null then excluded.progress
      when excluded.progress is null then public.whatsapp_sync_runs.progress
      else greatest(public.whatsapp_sync_runs.progress,excluded.progress) end,
    items_processed=public.whatsapp_sync_runs.items_processed+excluded.items_processed,
    completed_at=case
      when public.whatsapp_sync_runs.state in ('completed','failed') then public.whatsapp_sync_runs.completed_at
      when excluded.state in ('completed','failed') then excluded.completed_at
      else public.whatsapp_sync_runs.completed_at end,
    failure_code=case when excluded.state='failed' then excluded.failure_code else public.whatsapp_sync_runs.failure_code end,
    failure_message=case when excluded.state='failed' then excluded.failure_message else public.whatsapp_sync_runs.failure_message end
  returning id into v_id;
  update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
  return v_id;
end $$;

create or replace function public.record_whatsapp_contact_sync(
  p_external_event_key text,p_phone_number_id text,p_wa_id text,p_phone_e164 text,
  p_display_name text,p_action text,p_occurred_at timestamptz,p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_customer_id uuid;
begin
  if p_action not in ('add','remove') or p_wa_id !~ '^[0-9]{8,20}$' or p_phone_e164 !~ '^\+[1-9][0-9]{7,19}$' then raise exception 'Contato sincronizado inválido'; end if;
  insert into public.whatsapp_webhook_events(external_event_key,event_type,field,payload)
    values(p_external_event_key,'contact:'||p_action,'smb_app_state_sync',p_payload)
    on conflict(external_event_key) do nothing;
  if not found then select c.id into v_id from public.whatsapp_contacts c where c.phone_number_id=p_phone_number_id and c.wa_id=p_wa_id; return v_id; end if;
  v_customer_id := public.match_whatsapp_customer(p_phone_e164);
  insert into public.whatsapp_contacts(phone_number_id,wa_id,display_name,phone_e164,customer_id,source_updated_at,removed_at)
  values(trim(p_phone_number_id),p_wa_id,case when p_action='add' then nullif(left(trim(p_display_name),250),'') end,
    p_phone_e164,v_customer_id,p_occurred_at,case when p_action='remove' then p_occurred_at end)
  on conflict(phone_number_id,wa_id) do update set
    display_name=case when p_action='add' then excluded.display_name else null end,
    phone_e164=excluded.phone_e164,customer_id=v_customer_id,
    source_updated_at=excluded.source_updated_at,
    removed_at=case when p_action='remove' then p_occurred_at else null end
  where excluded.source_updated_at>public.whatsapp_contacts.source_updated_at
     or (excluded.source_updated_at=public.whatsapp_contacts.source_updated_at
       and p_action='remove' and public.whatsapp_contacts.removed_at is null)
  returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.whatsapp_contacts c where c.phone_number_id=trim(p_phone_number_id) and c.wa_id=p_wa_id;
  end if;
  update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
  return v_id;
end $$;

create or replace function public.record_whatsapp_account_update(
  p_external_event_key text,p_business_account_id text,p_business_phone_number text,p_event text,
  p_occurred_at timestamptz,p_disconnection_reason text,p_initiated_by text,p_payload jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_state public.whatsapp_connection_state;
begin
  insert into public.whatsapp_webhook_events(external_event_key,event_type,field,payload)
    values(p_external_event_key,'account:'||left(p_event,80),'account_update',p_payload)
    on conflict(external_event_key) do nothing;
  if not found then return false; end if;
  v_state := case
    when p_event in ('PARTNER_REMOVED','PARTNER_APP_UNINSTALLED') then 'removed'::public.whatsapp_connection_state
    when p_event='ACCOUNT_OFFBOARDED' or p_event ~ '(RESTRICTION|VIOLATION|DISABLED|BAN)' then 'attention'::public.whatsapp_connection_state
    when p_event='ACCOUNT_RECONNECTED' then 'coexistence_active'::public.whatsapp_connection_state
    when p_event in ('PARTNER_ADDED','PARTNER_APP_INSTALLED','ACCOUNT_ACTIVATED','ACCOUNT_CONNECTED','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') then 'coexistence_active'::public.whatsapp_connection_state
    else null end;
  update public.whatsapp_settings set connection_state=coalesce(v_state,connection_state),business_account_id=p_business_account_id,
    business_phone_number=coalesce(nullif(trim(p_business_phone_number),''),business_phone_number),
    last_account_event=left(p_event,100),disconnection_reason=left(p_disconnection_reason,100),
    disconnection_initiated_by=left(p_initiated_by,30),connection_updated_at=p_occurred_at
    where singleton and (connection_updated_at is null or p_occurred_at>=connection_updated_at);
  update public.whatsapp_webhook_events set processed_at=now() where external_event_key=p_external_event_key;
  return true;
end $$;

create or replace function public.record_whatsapp_unknown_event(
  p_external_event_key text,p_field text,p_payload jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.whatsapp_webhook_events(external_event_key,event_type,field,payload,processed_at)
    values(p_external_event_key,'unknown',left(coalesce(p_field,'unknown'),100),p_payload,now())
    on conflict(external_event_key) do nothing;
  return found;
end $$;

create or replace function public.record_whatsapp_passive_messages(p_messages jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_count integer := 0;
begin
  if jsonb_typeof(p_messages)<>'array' then raise exception 'Lote de mensagens inválido'; end if;
  for v_item in select value from jsonb_array_elements(p_messages) loop
    perform public.record_whatsapp_passive_message(
      v_item->>'eventKey',v_item->>'externalMessageId',v_item->>'phoneNumberId',v_item->>'waId',v_item->>'phoneE164',
      (v_item->>'direction')::public.whatsapp_message_direction,(v_item->>'origin')::public.whatsapp_message_origin,
      v_item->>'messageType',coalesce(v_item->>'contentText',''),(v_item->>'status')::public.whatsapp_message_status,
      (v_item->>'occurredAt')::timestamptz,coalesce(v_item->'payload','{}'::jsonb));
    v_count := v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.record_whatsapp_contacts_batch(p_contacts jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_count integer := 0;
begin
  if jsonb_typeof(p_contacts)<>'array' then raise exception 'Lote de contatos inválido'; end if;
  for v_item in select value from jsonb_array_elements(p_contacts) loop
    perform public.record_whatsapp_contact_sync(v_item->>'eventKey',v_item->>'phoneNumberId',v_item->>'waId',
      v_item->>'phoneE164',v_item->>'displayName',v_item->>'action',(v_item->>'occurredAt')::timestamptz,
      coalesce(v_item->'payload','{}'::jsonb));
    v_count := v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.record_whatsapp_sync_batch(p_sync jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_count integer := 0;
begin
  if jsonb_typeof(p_sync)<>'array' then raise exception 'Lote de sincronização inválido'; end if;
  for v_item in select value from jsonb_array_elements(p_sync) loop
    perform public.record_whatsapp_sync_progress(v_item->>'eventKey',v_item->>'phoneNumberId',
      (v_item->>'syncType')::public.whatsapp_sync_type,v_item->>'externalBatchId',
      (v_item->>'state')::public.whatsapp_sync_state,v_item->>'phase',nullif(v_item->>'progress','')::integer,
      coalesce((v_item->>'itemsProcessed')::integer,0),v_item->>'failureCode',v_item->>'failureMessage',
      coalesce(v_item->'payload','{}'::jsonb));
    v_count := v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.block_removed_whatsapp_outbox()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.whatsapp_settings s where s.singleton and s.connection_state in ('removed','attention')) then
    raise exception 'Integração do WhatsApp removida ou requer atenção';
  end if;
  return new;
end $$;
create trigger block_removed_whatsapp_outbox before insert on public.whatsapp_outbox
  for each row execute function public.block_removed_whatsapp_outbox();

create or replace function public.claim_whatsapp_outbox(p_worker_id text,p_limit integer default 20)
returns setof public.whatsapp_outbox language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(trim(p_worker_id),'')='' then raise exception 'worker_id obrigatório'; end if;
  if exists(select 1 from public.whatsapp_settings s where s.singleton and s.connection_state in ('removed','attention')) then return; end if;
  return query with candidates as (
    select o.id from public.whatsapp_outbox o
    where ((o.state in ('pending','retry') and o.next_attempt_at<=now())
      or (o.state='processing' and o.locked_at<now()-interval '5 minutes'))
    order by o.next_attempt_at,o.created_at for update skip locked limit least(greatest(p_limit,1),100)
  ) update public.whatsapp_outbox o set state='processing',locked_at=now(),locked_by=p_worker_id
    from candidates c where o.id=c.id returning o.*;
end $$;

revoke all on public.whatsapp_sync_runs,public.whatsapp_contacts from anon;
revoke all on function public.match_whatsapp_customer(text),
  public.upsert_whatsapp_passive_conversation(text,text,text,timestamptz,public.whatsapp_message_origin,public.whatsapp_message_direction),
  public.record_whatsapp_passive_message(text,text,text,text,text,public.whatsapp_message_direction,public.whatsapp_message_origin,text,text,public.whatsapp_message_status,timestamptz,jsonb),
  public.record_whatsapp_sync_progress(text,text,public.whatsapp_sync_type,text,public.whatsapp_sync_state,text,integer,integer,text,text,jsonb),
  public.record_whatsapp_contact_sync(text,text,text,text,text,text,timestamptz,jsonb),
  public.record_whatsapp_account_update(text,text,text,text,timestamptz,text,text,jsonb),
  public.record_whatsapp_unknown_event(text,text,jsonb),public.record_whatsapp_passive_messages(jsonb),
  public.record_whatsapp_contacts_batch(jsonb),public.record_whatsapp_sync_batch(jsonb),public.block_removed_whatsapp_outbox()
  from public,anon,authenticated;
grant execute on function
  public.record_whatsapp_passive_message(text,text,text,text,text,public.whatsapp_message_direction,public.whatsapp_message_origin,text,text,public.whatsapp_message_status,timestamptz,jsonb),
  public.record_whatsapp_sync_progress(text,text,public.whatsapp_sync_type,text,public.whatsapp_sync_state,text,integer,integer,text,text,jsonb),
  public.record_whatsapp_contact_sync(text,text,text,text,text,text,timestamptz,jsonb),
  public.record_whatsapp_account_update(text,text,text,text,timestamptz,text,text,jsonb),
  public.record_whatsapp_unknown_event(text,text,jsonb),public.record_whatsapp_passive_messages(jsonb),
  public.record_whatsapp_contacts_batch(jsonb),public.record_whatsapp_sync_batch(jsonb) to service_role;
