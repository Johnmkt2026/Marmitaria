-- npx supabase db query --local --file supabase/tests/admin_menu.sql
-- Teste transacional: RLS, visibilidade pública e integridade do cardápio.
do $test$
declare
  v_category uuid := gen_random_uuid();
  v_other_category uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_other_product uuid := gen_random_uuid();
  v_option uuid := gen_random_uuid();
  v_addon uuid := gen_random_uuid();
  v_meal_category uuid := gen_random_uuid();
  v_beverage_category uuid := gen_random_uuid();
  v_meal uuid := gen_random_uuid();
  v_beverage uuid := gen_random_uuid();
  v_count integer;
  v_rejected boolean := false;
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
begin
  begin
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('role', 'authenticated', true);
    assert public.is_admin();
    insert into public.categories(id,name,sort_order,active) values(v_category,'Teste Admin Menu',90,true),(v_other_category,'Teste Outra Categoria',91,true);
    insert into public.categories(id,name,sort_order,active)
      values(v_meal_category,'Pratos do dia',92,true),(v_beverage_category,'Bebidas',93,true)
      on conflict do nothing;
    select id into v_meal_category from public.categories where lower(trim(name))='pratos do dia';
    select id into v_beverage_category from public.categories where lower(trim(name))='bebidas';
    update public.categories set name='Teste Admin Menu Editado',sort_order=92 where id=v_category;
    insert into public.products(id,category_id,name,description,price_cents,image_url,sort_order,active)
      values(v_product,v_category,'Produto Teste','Descrição',1234,'🧪',90,true),
            (v_other_product,v_other_category,'Outro Produto','Descrição',2000,'📦',91,true);
    insert into public.products(id,category_id,name,public_name,product_type,description,price_cents,small_price_cents,large_price_cents,sort_order,active)
      values(v_meal,v_meal_category,'Refeição técnica','Prato do dia','meal','Descrição',2200,2200,2800,92,true),
            (v_beverage,v_beverage_category,'Bebida técnica','Bebida técnica','beverage',null,550,null,null,93,true);
    assert (select c.name from public.products p join public.categories c on c.id=p.category_id where p.id=v_meal)='Pratos do dia';
    assert (select public_name='Prato do dia' and price_cents=2200 and small_price_cents=2200 and large_price_cents=2800 from public.products where id=v_meal);
    assert (select c.name from public.products p join public.categories c on c.id=p.category_id where p.id=v_beverage)='Bebidas';
    insert into public.product_daily_availability(product_id,date,available_today,sold_out,sort_order)
      values(v_product,public.menu_date(),true,false,90);
    insert into public.product_options(id,product_id,name,required,min_choices,max_choices)
      values(v_option,v_product,'Escolha',false,0,2);
    insert into public.product_addons(id,product_id,option_id,name,price_cents,active,sort_order)
      values(v_addon,v_product,v_option,'Adicional Teste',250,true,1);
    assert (select name from public.categories where id=v_category)='Teste Admin Menu Editado';
    begin
      insert into public.categories(name) values('  teste admin menu editado  ');
    exception when unique_violation then v_rejected := true;
    end;
    assert v_rejected, 'Unicidade lower(trim(name)) não foi aplicada';
    v_rejected := false;
    update public.products set price_cents=999 where id=v_product and updated_at='1970-01-01'::timestamptz;
    get diagnostics v_count = row_count;
    assert v_count=0, 'Versão vencida sobrescreveu produto';

    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('role','anon',true);
    assert (select count(*) from public.products where id=v_product)=1;
    assert (select count(*) from public.product_daily_availability where product_id=v_product and date=public.menu_date())=1;
    assert (select count(*) from public.product_addons where id=v_addon)=1;
    v_rejected := false;
    begin
      insert into public.categories(name) values('Anon não pode');
    exception when insufficient_privilege then v_rejected := true;
    end;
    assert v_rejected, 'Anônimo criou categoria';
    perform set_config('role','postgres',true);

    perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
    perform set_config('role','authenticated',true);
    assert not public.is_admin();
    update public.products set price_cents=1 where id=v_product;
    get diagnostics v_count = row_count;
    assert v_count=0;
    perform set_config('role','postgres',true);

    update public.products set active=false where id=v_product;
    perform set_config('role','anon',true);
    assert (select count(*) from public.products where id=v_product)=0;
    perform set_config('role','postgres',true);
    update public.products set active=true where id=v_product;
    update public.categories set active=false where id=v_category;
    perform set_config('role','anon',true);
    assert (select count(*) from public.products where id=v_product)=0;
    perform set_config('role','postgres',true);
    update public.categories set active=true where id=v_category;

    update public.product_daily_availability set available_today=false where product_id=v_product and date=public.menu_date();
    perform set_config('role','anon',true);
    assert (select count(*) from public.product_daily_availability where product_id=v_product and date=public.menu_date())=0;
    perform set_config('role','postgres',true);
    update public.product_daily_availability set available_today=true,sold_out=true where product_id=v_product and date=public.menu_date();
    perform set_config('role','anon',true);
    assert (select sold_out from public.product_daily_availability where product_id=v_product and date=public.menu_date());
    perform set_config('role','postgres',true);

    update public.product_addons set active=false where id=v_addon;
    perform set_config('role','anon',true);
    assert (select count(*) from public.product_addons where id=v_addon)=0;
    perform set_config('role','postgres',true);

    begin
      insert into public.product_addons(product_id,option_id,name,price_cents) values(v_other_product,v_option,'Vínculo inválido',100);
    exception when foreign_key_violation then v_rejected := true;
    end;
    assert v_rejected, 'option_id de outro produto foi aceito';
    v_rejected := false;
    begin
      insert into public.product_options(product_id,name,min_choices,max_choices) values(v_product,'Inválida',-1,1);
    exception when check_violation then v_rejected := true;
    end;
    assert v_rejected, 'min_choices negativo foi aceito';
    v_rejected := false;
    begin
      insert into public.product_options(product_id,name,min_choices,max_choices) values(v_product,'Máximo inválido',2,1);
    exception when check_violation then v_rejected := true;
    end;
    assert v_rejected, 'max_choices menor que min_choices foi aceito';

    perform set_config('role','postgres',true);
    raise exception using errcode='ZX001',message='Restaurar dados após teste';
  exception when sqlstate 'ZX001' then null;
  end;
end $test$;
