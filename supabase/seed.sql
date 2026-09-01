-- SOMENTE DESENVOLVIMENTO LOCAL. Nunca executar este seed em produção.
-- Login local: admin@marmitaria.local / LocalDev-Marmitaria-2026!
-- Credenciais públicas de fixture, sem vínculo com conta pessoal ou produção.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb',
  'authenticated',
  'authenticated',
  'admin@marmitaria.local',
  crypt('LocalDev-Marmitaria-2026!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at;

-- Identidade de e-mail do administrador de teste local.
insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
values (
  'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb',
  'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb',
  'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb',
  '{"sub":"e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb","email":"admin@marmitaria.local","email_verified":true}',
  'email', now(), now()
) on conflict (provider_id, provider) do update set
  identity_data = excluded.identity_data,
  updated_at = excluded.updated_at;

-- Inserir na tabela admin_users
insert into public.admin_users (id)
values ('e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb')
on conflict (id) do nothing;

-- Configurações do restaurante
insert into public.restaurant_settings (
  id, name, is_open, delivery_fee_cents, delivery_minutes_min, delivery_minutes_max
) values (
  '00000000-0000-0000-0000-000000000001',
  'Marmitaria23',
  true,
  600,
  35,
  50
) on conflict (id) do update set
  name = excluded.name,
  is_open = excluded.is_open,
  delivery_fee_cents = excluded.delivery_fee_cents,
  delivery_minutes_min = excluded.delivery_minutes_min,
  delivery_minutes_max = excluded.delivery_minutes_max;

-- Categorias
insert into public.categories (id, name, sort_order, active)
values
  ('11111111-1111-1111-1111-111111111101', 'Marmitas', 1, true),
  ('11111111-1111-1111-1111-111111111102', 'Especiais', 2, true),
  ('11111111-1111-1111-1111-111111111103', 'Bebidas', 3, true)
on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order, active = excluded.active;

-- Produtos
insert into public.products (id, category_id, name, description, price_cents, image_url, sort_order, active)
values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 'Frango grelhado', 'Arroz, feijão, farofa e salada fresca.', 2490, '🍗', 1, true),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101', 'Carne de panela', 'Cozimento lento com legumes da estação.', 2990, '🥘', 2, true),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111101', 'Vegetariana colorida', 'Grãos, legumes assados e molho de ervas.', 2590, '🥗', 3, true),
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111102', 'Feijoada da casa', 'Porção completa para matar a saudade.', 3290, '🫘', 4, true),
  ('22222222-2222-2222-2222-222222222205', '11111111-1111-1111-1111-111111111103', 'Suco natural', 'Laranja, limão ou maracujá.', 700, '🧃', 5, true)
on conflict (id) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  image_url = excluded.image_url,
  sort_order = excluded.sort_order,
  active = excluded.active;

-- Disponibilidade diária dos produtos para a data atual
insert into public.product_daily_availability (product_id, date, available_today, sold_out, sort_order)
values
  ('22222222-2222-2222-2222-222222222201', public.menu_date(), true, false, 1),
  ('22222222-2222-2222-2222-222222222202', public.menu_date(), true, false, 2),
  ('22222222-2222-2222-2222-222222222203', public.menu_date(), true, false, 3),
  ('22222222-2222-2222-2222-222222222204', public.menu_date(), true, true, 4),
  ('22222222-2222-2222-2222-222222222205', public.menu_date(), true, false, 5)
on conflict (product_id, date) do update set
  available_today = excluded.available_today,
  sold_out = excluded.sold_out,
  sort_order = excluded.sort_order;

-- Grupos de opções
insert into public.product_options (id, product_id, name, required, min_choices, max_choices)
values
  ('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222201', 'Adicionais', false, 0, 5),
  ('33333333-3333-3333-3333-333333333302', '22222222-2222-2222-2222-222222222202', 'Adicionais', false, 0, 5),
  ('33333333-3333-3333-3333-333333333303', '22222222-2222-2222-2222-222222222203', 'Adicionais', false, 0, 5)
on conflict (id) do update set
  product_id = excluded.product_id,
  name = excluded.name,
  required = excluded.required,
  min_choices = excluded.min_choices,
  max_choices = excluded.max_choices;

-- Itens adicionais
insert into public.product_addons (id, product_id, option_id, name, price_cents, active, sort_order)
values
  ('44444444-4444-4444-4444-444444444401', '22222222-2222-2222-2222-222222222201', '33333333-3333-3333-3333-333333333301', 'Ovo frito', 200, true, 1),
  ('44444444-4444-4444-4444-444444444402', '22222222-2222-2222-2222-222222222201', '33333333-3333-3333-3333-333333333301', 'Farofa extra', 300, true, 2),
  ('44444444-4444-4444-4444-444444444403', '22222222-2222-2222-2222-222222222202', '33333333-3333-3333-3333-333333333302', 'Purê extra', 400, true, 1),
  ('44444444-4444-4444-4444-444444444404', '22222222-2222-2222-2222-222222222203', '33333333-3333-3333-3333-333333333303', 'Queijo coalho', 400, true, 1)
on conflict (id) do update set
  product_id = excluded.product_id,
  option_id = excluded.option_id,
  name = excluded.name,
  price_cents = excluded.price_cents,
  active = excluded.active,
  sort_order = excluded.sort_order;
