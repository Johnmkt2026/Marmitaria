-- Somente objetos explicitamente qualificados nas funções privilegiadas.
alter function public.is_admin() set search_path = '';
alter function public.log_order_status() set search_path = '';
alter function public.refresh_customer_stats() set search_path = '';

-- Leitura pública; escritas continuam protegidas por RLS.
drop policy "public menu products" on public.products;
create policy "public menu products" on public.products for select to anon, authenticated
  using (active and exists(select 1 from public.categories c where c.id = category_id and c.active));
create policy "public options" on public.product_options for select to anon, authenticated
  using (exists(select 1 from public.products p where p.id = product_id and p.active));
create policy "public addons" on public.product_addons for select to anon, authenticated
  using (active and exists(select 1 from public.products p where p.id = product_id and p.active));
create policy "public settings" on public.restaurant_settings for select to anon, authenticated using (true);
create policy "admin read order addons" on public.order_item_addons for select to authenticated
  using (public.is_admin());
alter table public.customers drop constraint if exists customers_whatsapp_normalized_check;
alter table public.customers add constraint customers_whatsapp_normalized_check check (whatsapp_normalized ~ '^[+]?[0-9]{10,15}$');

-- Data comercial compartilhada pelo cardápio, seed e pedidos.
create or replace function public.menu_date() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

drop policy "public daily availability" on public.product_daily_availability;
create policy "public daily availability" on public.product_daily_availability for select to anon, authenticated
  using (available_today and date = public.menu_date()
    and exists(select 1 from public.products p where p.id = product_id and p.active));

drop function if exists public.create_order(text, text, public.delivery_method, public.payment_method, text, text, jsonb);
create or replace function public.create_order(
  p_customer_name text, p_whatsapp text,
  p_delivery_method public.delivery_method, p_payment_method public.payment_method,
  p_address text, p_notes text, p_items jsonb, p_change_for_cents integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_order uuid;
  v_order_number bigint;
  v_order_item uuid;
  v_subtotal integer := 0;
  v_delivery_fee integer;
  v_total integer;
  v_whatsapp text := regexp_replace(p_whatsapp, '[^0-9+]', '', 'g');
  v_settings record;
  v_item jsonb;
  v_product record;
  v_quantity integer;
  v_addon_id text;
  v_addon record;
  v_option record;
  v_choices integer;
  v_addon_ids uuid[];
begin
  if p_customer_name is null or length(trim(p_customer_name)) not between 2 and 120 then
    raise exception 'Informe um nome válido';
  end if;
  if v_whatsapp is null or v_whatsapp !~ '^[+]?[0-9]{10,15}$' then
    raise exception 'Informe um WhatsApp válido';
  end if;
  if p_delivery_method is null or p_payment_method is null then
    raise exception 'Informe entrega e pagamento';
  end if;
  if p_delivery_method = 'delivery' and coalesce(length(trim(p_address)), 0) < 5 then
    raise exception 'Informe o endereço de entrega';
  end if;
  if length(p_address) > 500 or length(p_notes) > 1000 then
    raise exception 'Endereço ou observação excede o limite';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Itens devem ser uma lista'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'O pedido deve ter de 1 a 100 itens'; end if;

  select * into v_settings from public.restaurant_settings order by created_at, id limit 1 for share;
  if not found then raise exception 'Restaurante não configurado'; end if;
  if not v_settings.is_open then raise exception 'Restaurante fechado'; end if;
  v_delivery_fee := case when p_delivery_method = 'delivery' then v_settings.delivery_fee_cents else 0 end;

  insert into public.customers(name, whatsapp_normalized) values(trim(p_customer_name), v_whatsapp)
  on conflict(whatsapp_normalized) do update set name = excluded.name returning id into v_customer;
  -- A transação inteira é revertida em qualquer erro, incluindo cliente e histórico.
  insert into public.orders(customer_id, delivery_method, payment_method, customer_name_snapshot,
    whatsapp_snapshot, address_snapshot, notes, subtotal_cents, delivery_fee_cents, total_cents)
  values(v_customer, p_delivery_method, p_payment_method, trim(p_customer_name), v_whatsapp,
    case when p_delivery_method = 'delivery' then trim(p_address) else null end,
    nullif(trim(p_notes), ''), 0, v_delivery_fee, v_delivery_fee)
  returning id, order_number into v_order, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'product_id') is distinct from 'string'
      or coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'product_id inválido';
    end if;
    if jsonb_typeof(v_item->'quantity') is distinct from 'number'
      or coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]{0,2}$' then
      raise exception 'Quantidade deve ser um inteiro entre 1 e 999';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_item ? 'notes' and (jsonb_typeof(v_item->'notes') is distinct from 'string' or length(v_item->>'notes') > 500) then
      raise exception 'Observação do item inválida';
    end if;
    select p.id, p.name, p.price_cents into v_product from public.products p
    join public.categories c on c.id = p.category_id
    join public.product_daily_availability a on a.product_id = p.id and a.date = public.menu_date()
    where p.id = (v_item->>'product_id')::uuid and p.active and c.active and a.available_today and not a.sold_out
    for share of p, c, a;
    if not found then raise exception 'Produto indisponível'; end if;

    if v_item ? 'addon_ids' and jsonb_typeof(v_item->'addon_ids') is distinct from 'array' then
      raise exception 'addon_ids deve ser uma lista';
    end if;
    if jsonb_array_length(coalesce(v_item->'addon_ids', '[]'::jsonb)) > 100 then
      raise exception 'Limite de adicionais excedido';
    end if;
    v_addon_ids := array[]::uuid[];
    for v_addon_id in select value from jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) loop
      if v_addon_id is null or v_addon_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'addon_id inválido';
      end if;
      if v_addon_id::uuid = any(v_addon_ids) then raise exception 'Adicional duplicado'; end if;
      v_addon_ids := array_append(v_addon_ids, v_addon_id::uuid);
    end loop;

    insert into public.order_items(order_id, product_id, product_name_snapshot, unit_price_cents, quantity, notes)
    values(v_order, v_product.id, v_product.name, v_product.price_cents, v_quantity, nullif(trim(v_item->>'notes'), ''))
    returning id into v_order_item;
    v_subtotal := v_subtotal + v_product.price_cents * v_quantity;
    foreach v_addon_id in array v_addon_ids::text[] loop
      select a.* into v_addon from public.product_addons a
      where a.id = v_addon_id::uuid and a.product_id = v_product.id and a.active for share;
      if not found then raise exception 'Adicional indisponível ou de outro produto'; end if;
      if v_addon.option_id is not null and not exists(
        select 1 from public.product_options where id = v_addon.option_id and product_id = v_product.id
      ) then raise exception 'Grupo do adicional inválido'; end if;
      -- Quantidade TOTAL do adicional na linha, igual à quantidade de produtos.
      insert into public.order_item_addons(order_item_id, addon_id, addon_name_snapshot, unit_price_cents, quantity)
      values(v_order_item, v_addon.id, v_addon.name, v_addon.price_cents, v_quantity);
      v_subtotal := v_subtotal + v_addon.price_cents * v_quantity;
    end loop;
    for v_option in select * from public.product_options where product_id = v_product.id for share loop
      select count(*) into v_choices from public.product_addons where id = any(v_addon_ids) and option_id = v_option.id;
      if v_choices < greatest(v_option.min_choices, case when v_option.required then 1 else 0 end)
        or v_choices > v_option.max_choices then
        raise exception 'Seleção inválida para o grupo %', v_option.name;
      end if;
    end loop;
  end loop;
  v_total := v_subtotal + v_delivery_fee;
  if p_change_for_cents is not null and (p_payment_method <> 'cash' or p_change_for_cents < v_total) then
    raise exception 'Troco deve ser para um valor igual ou superior ao total, com pagamento em dinheiro';
  end if;
  update public.orders set subtotal_cents = v_subtotal, total_cents = v_total,
    change_for_cents = p_change_for_cents where id = v_order;
  return jsonb_build_object('order_id', v_order, 'order_number', v_order_number,
    'subtotal_cents', v_subtotal, 'delivery_fee_cents', v_delivery_fee, 'total_cents', v_total);
end $$;
revoke all on function public.create_order(text, text, public.delivery_method, public.payment_method, text, text, jsonb, integer) from public;
grant execute on function public.create_order(text, text, public.delivery_method, public.payment_method, text, text, jsonb, integer) to anon, authenticated;
