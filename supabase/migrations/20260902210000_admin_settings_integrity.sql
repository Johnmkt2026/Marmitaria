alter table public.restaurant_settings
  add constraint restaurant_settings_name_not_blank
    check (length(trim(name)) > 0),
  add constraint restaurant_settings_delivery_minutes_min_nonnegative
    check (delivery_minutes_min is null or delivery_minutes_min >= 0),
  add constraint restaurant_settings_delivery_minutes_max_nonnegative
    check (delivery_minutes_max is null or delivery_minutes_max >= 0),
  add constraint restaurant_settings_delivery_minutes_order
    check (delivery_minutes_min is null or delivery_minutes_max is null or delivery_minutes_max >= delivery_minutes_min);

-- A aplicação representa uma única operação. Um índice único sobre uma
-- expressão constante mantém o registro identificável por id e impede que
-- qualquer caminho de escrita crie uma segunda configuração.
create unique index restaurant_settings_singleton_idx
  on public.restaurant_settings ((true));
