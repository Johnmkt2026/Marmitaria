-- Prepara envio manual oficial de texto ou template. A ativação da integração
-- continua exclusivamente nas Edge Functions/Server Actions por secret.
create or replace function public.queue_whatsapp_outbound(
  p_conversation_id uuid,
  p_message_type text,
  p_content_text text default null,
  p_template_name text default null,
  p_template_language text default null,
  p_template_components jsonb default null,
  p_order_id uuid default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_conversation public.whatsapp_conversations;
  v_message_id uuid;
  v_key text;
  v_type text := trim(coalesce(p_message_type, ''));
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if v_type not in ('text', 'template') then raise exception 'Tipo de mensagem inválido'; end if;

  select * into v_conversation from public.whatsapp_conversations
    where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada'; end if;
  if v_conversation.wa_id !~ '^[0-9]{8,20}$' then raise exception 'Identidade WhatsApp inválida'; end if;

  if p_order_id is not null and not exists(
    select 1 from public.orders o where o.id = p_order_id
      and (v_conversation.customer_id is null or o.customer_id = v_conversation.customer_id)
  ) then raise exception 'Pedido não pertence à conversa'; end if;

  if v_type = 'text' then
    if length(trim(coalesce(p_content_text, ''))) not between 1 and 2000 then
      raise exception 'A mensagem deve conter entre 1 e 2000 caracteres';
    end if;
    if v_conversation.service_window_expires_at is null or v_conversation.service_window_expires_at <= now() then
      raise exception 'A janela de atendimento de 24 horas está encerrada';
    end if;
    if p_template_name is not null or p_template_language is not null or p_template_components is not null then
      raise exception 'Texto livre não aceita dados de template';
    end if;
  else
    if length(trim(coalesce(p_template_name), '')) not between 1 and 512
      or trim(p_template_name) !~ '^[a-z0-9_]+$' then raise exception 'Nome de template inválido'; end if;
    if coalesce(trim(p_template_language), '') !~ '^[a-z]{2}(_[A-Z]{2})?$' then raise exception 'Idioma de template inválido'; end if;
    if p_template_components is null or jsonb_typeof(p_template_components) <> 'array' then
      raise exception 'Componentes de template inválidos';
    end if;
    if p_content_text is not null and length(p_content_text) > 2000 then raise exception 'Prévia do template muito extensa'; end if;
  end if;

  v_key := coalesce(nullif(trim(p_idempotency_key), ''), 'manual:' || gen_random_uuid()::text);
  insert into public.whatsapp_messages(conversation_id, idempotency_key, customer_id, order_id,
    direction, message_type, content_text, template_name, template_language, template_components,
    status, automatic, created_by)
  values(v_conversation.id, v_key, v_conversation.customer_id, coalesce(p_order_id, v_conversation.latest_order_id),
    'outbound', v_type, case when v_type='text' then trim(p_content_text) else p_content_text end,
    case when v_type='template' then trim(p_template_name) end,
    case when v_type='template' then trim(p_template_language) end,
    case when v_type='template' then p_template_components end,
    'queued', false, auth.uid())
  returning id into v_message_id;

  insert into public.whatsapp_outbox(message_id, order_id, event_type, payload)
  values(v_message_id, coalesce(p_order_id, v_conversation.latest_order_id), 'manual_message',
    jsonb_strip_nulls(jsonb_build_object(
      'conversation_id', v_conversation.id,
      'wa_id', v_conversation.wa_id,
      'message_type', v_type,
      'content_text', case when v_type='text' then trim(p_content_text) end,
      'template_name', case when v_type='template' then trim(p_template_name) end,
      'template_language', case when v_type='template' then trim(p_template_language) end,
      'template_components', case when v_type='template' then p_template_components end
    )));

  update public.whatsapp_conversations set last_outbound_at=now(), last_message_at=now(), state='active'
    where id=v_conversation.id;
  return v_message_id;
end $$;

revoke all on function public.queue_whatsapp_outbound(uuid,text,text,text,text,jsonb,uuid,text)
  from public, anon;
grant execute on function public.queue_whatsapp_outbound(uuid,text,text,text,text,jsonb,uuid,text)
  to authenticated;
