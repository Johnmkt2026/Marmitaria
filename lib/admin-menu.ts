import 'server-only';
import { requireAdminClient } from '@/lib/admin-orders';
import type { AdminMenuAddon, AdminMenuAvailability, AdminMenuCategory, AdminMenuData, AdminMenuOption, AdminMenuProduct } from '@/lib/admin-menu-types';

type ProductRow = Omit<AdminMenuProduct, 'availability' | 'options' | 'addons'>;

export async function getAdminMenu(): Promise<AdminMenuData> {
  const db = await requireAdminClient();
  const { data: date, error: dateError } = await db.rpc('menu_date');
  if (dateError || typeof date !== 'string') throw new Error('Data comercial indisponível');
  // Número constante de consultas em lote; nenhuma consulta é feita dentro de loops.
  const [categories, products, availability, options, addons] = await Promise.all([
    db.from('categories').select('id,name,sort_order,active,updated_at').order('sort_order').order('name').returns<AdminMenuCategory[]>(),
    db.from('products').select('id,category_id,name,public_name,product_type,description,price_cents,small_price_cents,large_price_cents,image_url,sort_order,active,updated_at').order('sort_order').order('name').returns<ProductRow[]>(),
    db.from('product_daily_availability').select('id,product_id,date,available_today,sold_out,sort_order,updated_at').eq('date', date).order('sort_order').returns<AdminMenuAvailability[]>(),
    db.from('product_options').select('id,product_id,name,required,min_choices,max_choices,updated_at').order('created_at').order('id').returns<AdminMenuOption[]>(),
    db.from('product_addons').select('id,product_id,option_id,name,price_cents,active,sort_order,updated_at').order('sort_order').order('name').returns<AdminMenuAddon[]>(),
  ]);
  if ([categories, products, availability, options, addons].some(result => result.error)) throw new Error('Falha ao carregar o cardápio administrativo');
  const daily = new Map((availability.data ?? []).map(item => [item.product_id, item]));
  return {
    date,
    categories: categories.data ?? [],
    products: (products.data ?? []).map(product => ({
      ...product, availability: daily.get(product.id) ?? null,
      options: (options.data ?? []).filter(option => option.product_id === product.id),
      addons: (addons.data ?? []).filter(addon => addon.product_id === product.id),
    })),
  };
}
