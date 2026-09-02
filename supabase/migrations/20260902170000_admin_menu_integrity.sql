alter table public.categories drop constraint categories_name_key;
create unique index categories_name_lower_unique on public.categories(lower(trim(name)));

alter table public.product_options
  add constraint product_options_min_choices_nonnegative check (min_choices >= 0),
  add constraint product_options_id_product_unique unique (id, product_id);

alter table public.product_addons
  drop constraint product_addons_option_id_fkey,
  add constraint product_addons_option_same_product
  foreign key (option_id, product_id) references public.product_options(id, product_id) on delete cascade;
