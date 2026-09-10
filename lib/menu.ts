import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { DailyMenu, MenuAddon, MenuCategory, MenuOption, MenuProduct, RestaurantSettings } from '@/lib/menu-types';

type ProductRow = Omit<MenuProduct, 'sold_out' | 'options' | 'addons'>;
type Availability = { product_id: string; sold_out: boolean };

export async function getDailyMenu(): Promise<DailyMenu> {
  const db = await createClient();
  if (!db) throw new Error('Supabase não configurado');
  const { data: today, error: dateError } = await db.rpc('menu_date');
  if (dateError || typeof today !== 'string') throw new Error('Data do cardápio indisponível');
  const [settings, categories, products, availability, options, addons] = await Promise.all([
    db.from('restaurant_settings').select('name,is_open,delivery_fee_cents,delivery_minutes_min,delivery_minutes_max').order('created_at').order('id').limit(1).returns<RestaurantSettings[]>(),
    db.from('categories').select('id,name').eq('active', true).order('sort_order').order('name').returns<MenuCategory[]>(),
    db.from('products').select('id,category_id,name:public_name,description,product_type,price_cents,small_price_cents,large_price_cents,image_url').eq('active', true).order('sort_order').order('name').returns<ProductRow[]>(),
    db.from('product_daily_availability').select('product_id,sold_out').eq('date', today).eq('available_today', true).order('sort_order').order('product_id').returns<Availability[]>(),
    db.from('product_options').select('id,product_id,name,required,min_choices,max_choices').order('created_at').order('id').returns<MenuOption[]>(),
    db.from('product_addons').select('id,product_id,option_id,name,price_cents').eq('active', true).order('sort_order').order('name').returns<MenuAddon[]>(),
  ]);
  if ([settings, categories, products, availability, options, addons].some(result => result.error)) {
    throw new Error('Falha ao consultar o cardápio');
  }
  const restaurant = settings.data?.[0];
  if (!restaurant) throw new Error('Restaurante não configurado');
  const activeCategories = categories.data ?? [];
  const availabilityByProduct = new Map((availability.data ?? []).map(row => [row.product_id, row]));
  const dailyProducts = (products.data ?? []).flatMap(product => {
    if (product.product_type === 'meal' && !activeCategories.some(category => category.id === product.category_id)) return [];
    const daily = availabilityByProduct.get(product.id);
    if (product.product_type === 'meal' && !daily) return [];
    return [{ ...product, sold_out: product.product_type === 'meal' ? daily!.sold_out : false,
      options: (options.data ?? []).filter(option => option.product_id === product.id),
      addons: (addons.data ?? []).filter(addon => addon.product_id === product.id),
    }];
  });
  return { restaurant, categories: activeCategories, products: dailyProducts };
}
