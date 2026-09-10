do $$ begin
  create type public.order_item_size as enum ('small', 'large');
exception when duplicate_object then null;
end $$;

alter table public.order_items
  add column public_name_snapshot text,
  add column size_snapshot public.order_item_size;

update public.order_items set public_name_snapshot = product_name_snapshot where public_name_snapshot is null;

alter table public.order_items
  alter column public_name_snapshot set not null,
  add constraint order_items_public_name_snapshot_not_blank check (length(trim(public_name_snapshot)) >= 2);

create function public.prepare_order_item_catalog_snapshots()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.public_name_snapshot := coalesce(new.public_name_snapshot, new.product_name_snapshot);
  return new;
end;
$$;

create trigger prepare_order_item_catalog_snapshots_before_insert
before insert on public.order_items for each row
execute function public.prepare_order_item_catalog_snapshots();

revoke all on function public.prepare_order_item_catalog_snapshots() from public;

comment on column public.order_items.product_name_snapshot is 'Nome interno histórico para operação e relatórios.';
comment on column public.order_items.public_name_snapshot is 'Nome histórico exibido ao cliente.';
comment on column public.order_items.size_snapshot is 'Tamanho histórico escolhido; nulo para bebidas e pedidos anteriores.';

create or replace function public.create_order(
  p_customer_name text, p_whatsapp text,
  p_delivery_method public.delivery_method, p_payment_method public.payment_method,
  p_address text, p_notes text, p_items jsonb, p_change_for_cents integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid; v_order uuid; v_order_number bigint; v_order_item uuid;
  v_subtotal integer := 0; v_delivery_fee integer; v_total integer;
  v_whatsapp text := regexp_replace(p_whatsapp, '[^0-9+]', '', 'g');
  v_settings record; v_item jsonb; v_product record; v_quantity integer; v_unit_price integer;
  v_size public.order_item_size; v_addon_id text; v_addon record; v_option record;
  v_choices integer; v_addon_ids uuid[]; v_receipt_items jsonb;
begin
  if p_customer_name is null or length(trim(p_customer_name)) not between 2 and 120 then raise exception 'Informe um nome válido'; end if;
  if v_whatsapp is null or v_whatsapp !~ '^[+]?[0-9]{10,15}$' then raise exception 'Informe um WhatsApp válido'; end if;
  if p_delivery_method is null or p_payment_method is null then raise exception 'Informe entrega e pagamento'; end if;
  if p_delivery_method = 'delivery' and coalesce(length(trim(p_address)), 0) < 5 then raise exception 'Informe o endereço de entrega'; end if;
  if length(p_address) > 500 or length(p_notes) > 1000 then raise exception 'Endereço ou observação excede o limite'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Itens devem ser uma lista'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'O pedido deve ter de 1 a 100 itens'; end if;

  select * into v_settings from public.restaurant_settings order by created_at, id limit 1 for share;
  if not found then raise exception 'Restaurante não configurado'; end if;
  if not v_settings.is_open then raise exception 'Restaurante fechado'; end if;
  v_delivery_fee := case when p_delivery_method = 'delivery' then v_settings.delivery_fee_cents else 0 end;

  insert into public.customers(name, whatsapp_normalized) values(trim(p_customer_name), v_whatsapp)
  on conflict(whatsapp_normalized) do update set name = excluded.name returning id into v_customer;
  insert into public.orders(customer_id, delivery_method, payment_method, customer_name_snapshot, whatsapp_snapshot,
    address_snapshot, notes, subtotal_cents, delivery_fee_cents, total_cents)
  values(v_customer, p_delivery_method, p_payment_method, trim(p_customer_name), v_whatsapp,
    case when p_delivery_method = 'delivery' then trim(p_address) else null end,
    nullif(trim(p_notes), ''), 0, v_delivery_fee, v_delivery_fee)
  returning id, order_number into v_order, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'product_id') is distinct from 'string'
      or coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'product_id inválido'; end if;
    if jsonb_typeof(v_item->'quantity') is distinct from 'number' or coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]{0,2}$' then raise exception 'Quantidade deve ser um inteiro entre 1 e 999'; end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_item ? 'notes' and (jsonb_typeof(v_item->'notes') is distinct from 'string' or length(v_item->>'notes') > 500) then raise exception 'Observação do item inválida'; end if;

    select p.id, p.name, p.public_name, p.product_type, p.price_cents, p.small_price_cents, p.large_price_cents
      into v_product from public.products p join public.categories c on c.id=p.category_id
      where p.id=(v_item->>'product_id')::uuid and p.active and c.active for share of p,c;
    if not found then raise exception 'Produto indisponível'; end if;
    if v_product.product_type = 'meal' then
      if jsonb_typeof(v_item->'size') is distinct from 'string' or coalesce(v_item->>'size','') not in ('small','large') then raise exception 'Escolha o tamanho Pequena ou Grande'; end if;
      v_size := (v_item->>'size')::public.order_item_size;
      v_unit_price := case v_size when 'small' then v_product.small_price_cents else v_product.large_price_cents end;
      if v_unit_price is null then raise exception 'Preço do tamanho indisponível'; end if;
      perform 1 from public.product_daily_availability a where a.product_id=v_product.id and a.date=public.menu_date() and a.available_today and not a.sold_out for share;
      if not found then raise exception 'Produto indisponível'; end if;
    else
      if v_item ? 'size' and jsonb_typeof(v_item->'size') is distinct from 'null' then raise exception 'Bebidas não aceitam tamanho'; end if;
      v_size := null; v_unit_price := v_product.price_cents;
    end if;

    if v_item ? 'addon_ids' and jsonb_typeof(v_item->'addon_ids') is distinct from 'array' then raise exception 'addon_ids deve ser uma lista'; end if;
    if jsonb_array_length(coalesce(v_item->'addon_ids','[]'::jsonb)) > 100 then raise exception 'Limite de adicionais excedido'; end if;
    v_addon_ids := array[]::uuid[];
    for v_addon_id in select value from jsonb_array_elements_text(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
      if v_addon_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'addon_id inválido'; end if;
      if v_addon_id::uuid=any(v_addon_ids) then raise exception 'Adicional duplicado'; end if;
      v_addon_ids:=array_append(v_addon_ids,v_addon_id::uuid);
    end loop;
    if v_product.product_type='beverage' and cardinality(v_addon_ids)>0 then raise exception 'Bebidas não aceitam adicionais'; end if;

    insert into public.order_items(order_id,product_id,product_name_snapshot,public_name_snapshot,size_snapshot,unit_price_cents,quantity,notes)
    values(v_order,v_product.id,v_product.name,v_product.public_name,v_size,v_unit_price,v_quantity,nullif(trim(v_item->>'notes'),'')) returning id into v_order_item;
    v_subtotal:=v_subtotal+v_unit_price*v_quantity;
    foreach v_addon_id in array v_addon_ids::text[] loop
      select a.* into v_addon from public.product_addons a where a.id=v_addon_id::uuid and a.product_id=v_product.id and a.active for share;
      if not found then raise exception 'Adicional indisponível ou de outro produto'; end if;
      if v_addon.option_id is not null and not exists(select 1 from public.product_options where id=v_addon.option_id and product_id=v_product.id) then raise exception 'Grupo do adicional inválido'; end if;
      insert into public.order_item_addons(order_item_id,addon_id,addon_name_snapshot,unit_price_cents,quantity)
      values(v_order_item,v_addon.id,v_addon.name,v_addon.price_cents,v_quantity);
      v_subtotal:=v_subtotal+v_addon.price_cents*v_quantity;
    end loop;
    if v_product.product_type='meal' then
      for v_option in select * from public.product_options where product_id=v_product.id for share loop
        select count(*) into v_choices from public.product_addons where id=any(v_addon_ids) and option_id=v_option.id;
        if v_choices<greatest(v_option.min_choices,case when v_option.required then 1 else 0 end) or v_choices>v_option.max_choices then raise exception 'Seleção inválida para o grupo %',v_option.name; end if;
      end loop;
    end if;
  end loop;
  v_total:=v_subtotal+v_delivery_fee;
  if p_change_for_cents is not null and (p_payment_method<>'cash' or p_change_for_cents<v_total) then raise exception 'Troco deve ser para um valor igual ou superior ao total, com pagamento em dinheiro'; end if;
  update public.orders set subtotal_cents=v_subtotal,total_cents=v_total,change_for_cents=p_change_for_cents where id=v_order;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.public_name_snapshot,'size',i.size_snapshot,'unit_price_cents',i.unit_price_cents,'quantity',i.quantity,'notes',i.notes,'addons',coalesce((select jsonb_agg(jsonb_build_object('name',a.addon_name_snapshot,'unit_price_cents',a.unit_price_cents,'quantity',a.quantity) order by a.id) from public.order_item_addons a where a.order_item_id=i.id),'[]'::jsonb)) order by i.id),'[]'::jsonb) into v_receipt_items from public.order_items i where i.order_id=v_order;
  return jsonb_build_object('order_id',v_order,'order_number',v_order_number,'subtotal_cents',v_subtotal,'delivery_fee_cents',v_delivery_fee,'total_cents',v_total,'items',v_receipt_items);
end $$;

revoke all on function public.create_order(text,text,public.delivery_method,public.payment_method,text,text,jsonb,integer) from public;
grant execute on function public.create_order(text,text,public.delivery_method,public.payment_method,text,text,jsonb,integer) to anon, authenticated;
