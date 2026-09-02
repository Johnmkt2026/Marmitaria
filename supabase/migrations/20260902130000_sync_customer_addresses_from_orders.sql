-- Mantém o endereço atual do pedido como snapshot e registra uma cópia reutilizável no CRM.
create or replace function public.sync_customer_address_from_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.delivery_method = 'delivery' and nullif(trim(new.address_snapshot), '') is not null
    and not exists (
      select 1 from public.customer_addresses a
      where a.customer_id = new.customer_id
        and lower(trim(a.address_line)) = lower(trim(new.address_snapshot))
    ) then
    insert into public.customer_addresses(customer_id, label, address_line)
    values(new.customer_id, 'Entrega', trim(new.address_snapshot));
  end if;
  return new;
end
$$;

revoke all on function public.sync_customer_address_from_order() from public;

create trigger order_customer_address
after insert on public.orders
for each row execute function public.sync_customer_address_from_order();

-- Inclui entregas anteriores sem alterar os snapshots históricos dos pedidos.
insert into public.customer_addresses(customer_id, label, address_line)
select distinct on (o.customer_id, lower(trim(o.address_snapshot)))
  o.customer_id, 'Entrega', trim(o.address_snapshot)
from public.orders o
where o.delivery_method = 'delivery'
  and nullif(trim(o.address_snapshot), '') is not null
  and not exists (
    select 1 from public.customer_addresses a
    where a.customer_id = o.customer_id
      and lower(trim(a.address_line)) = lower(trim(o.address_snapshot))
  )
order by o.customer_id, lower(trim(o.address_snapshot)), o.created_at desc;
