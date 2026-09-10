do $$ begin
  create type public.product_type as enum ('meal', 'beverage');
exception when duplicate_object then null;
end $$;

alter table public.products
  add column product_type public.product_type not null default 'meal',
  add column public_name text default 'Prato do dia',
  add column small_price_cents integer,
  add column large_price_cents integer;

update public.products p
set product_type = case when lower(trim(c.name)) in ('bebida', 'bebidas') then 'beverage'::public.product_type else 'meal'::public.product_type end,
    public_name = case when lower(trim(c.name)) in ('bebida', 'bebidas') then p.name else 'Prato do dia' end,
    small_price_cents = case when lower(trim(c.name)) in ('bebida', 'bebidas') then null else p.price_cents end,
    large_price_cents = case when lower(trim(c.name)) in ('bebida', 'bebidas') then null else p.price_cents end
from public.categories c
where c.id = p.category_id;

update public.products set public_name = name where public_name is null;

alter table public.products
  alter column public_name set not null,
  add constraint products_public_name_not_blank check (length(trim(public_name)) >= 2),
  add constraint products_small_price_nonnegative check (small_price_cents is null or small_price_cents >= 0),
  add constraint products_large_price_nonnegative check (large_price_cents is null or large_price_cents >= 0),
  add constraint products_type_prices_consistent check (
    (product_type = 'meal' and small_price_cents is not null and large_price_cents is not null)
    or (product_type = 'beverage' and small_price_cents is null and large_price_cents is null)
  );

create function public.prepare_product_catalog_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_type = 'meal' then
    new.public_name := 'Prato do dia';
    new.small_price_cents := coalesce(new.small_price_cents, new.price_cents);
    new.large_price_cents := coalesce(new.large_price_cents, new.price_cents);
  else
    new.public_name := new.name;
    new.small_price_cents := null;
    new.large_price_cents := null;
  end if;
  return new;
end;
$$;

create trigger prepare_product_catalog_fields_before_insert
before insert on public.products
for each row execute function public.prepare_product_catalog_fields();

revoke all on function public.prepare_product_catalog_fields() from public;

create index products_type_active_idx on public.products(product_type, active, sort_order);

comment on column public.products.name is 'Identificação interna e snapshot administrativo histórico.';
comment on column public.products.public_name is 'Nome destinado à experiência pública; refeições usam Prato do dia.';
comment on column public.products.price_cents is 'Preço compatível com create_order; refeições usam o preço Pequena até a integração pública de variantes.';
