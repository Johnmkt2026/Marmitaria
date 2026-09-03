-- npx supabase db query --local --file supabase/tests/product_images.sql
do $test$
declare
  v_admin uuid := 'e8c744b6-38b6-4e5d-99dd-8eb59e5ae6fb';
  v_count integer;
  v_rejected boolean := false;
begin
  assert (select public and file_size_limit = 5242880 from storage.buckets where id = 'product-images');
  assert (select allowed_mime_types @> array['image/jpeg','image/png','image/webp'] from storage.buckets where id = 'product-images');

  begin
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('role', 'authenticated', true);
    insert into storage.objects(bucket_id, name, owner_id, metadata)
      values('product-images', 'products/test/admin.webp', v_admin::text, '{"mimetype":"image/webp","size":4}');
    assert (select count(*) from storage.objects where bucket_id='product-images' and name='products/test/admin.webp') = 1;
    assert (select count(*) = 4 from pg_policies where schemaname='storage' and tablename='objects' and policyname in
      ('product images public read','admins upload product images','admins update product images','admins delete product images'));

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('role', 'anon', true);
    v_rejected := false;
    begin
      insert into storage.objects(bucket_id, name, metadata)
        values('product-images', 'products/test/anon.webp', '{"mimetype":"image/webp","size":4}');
    exception when insufficient_privilege then v_rejected := true;
    end;
    assert v_rejected, 'Anônimo conseguiu enviar imagem';

    perform set_config('role', 'postgres', true);
    insert into storage.objects(bucket_id, name, metadata)
      values('product-images', 'products/test/public.webp', '{"mimetype":"image/webp","size":4}');
    perform set_config('role', 'anon', true);
    assert (select count(*) from storage.objects where bucket_id='product-images' and name='products/test/public.webp') = 1;
    update storage.objects set name='products/test/changed.webp' where bucket_id='product-images' and name='products/test/public.webp';
    get diagnostics v_count = row_count;
    assert v_count = 0, 'Anônimo alterou imagem';
    perform set_config('role', 'postgres', true);
    raise exception using errcode='ZX001', message='Restaurar dados após teste';
  exception when sqlstate 'ZX001' then null;
  end;
end $test$;
