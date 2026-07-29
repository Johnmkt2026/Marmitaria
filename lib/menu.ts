import { createClient } from '@/lib/supabase/server';
export type MenuProduct = { id:string; name:string; description:string|null; price_cents:number; image_url:string|null; available_today:boolean; sold_out:boolean; category_id:string; category_name:string };
export async function getDailyMenu(): Promise<MenuProduct[]> {
  const supabase = await createClient(); if (!supabase) return [];
  const today = new Date().toISOString().slice(0,10);
  const { data } = await supabase.from('product_daily_availability').select('available_today,sold_out,products!inner(id,name,description,price_cents,image_url,active,category_id,categories!inner(name))').eq('date', today).eq('available_today', true).eq('products.active', true).order('sort_order');
  return (data ?? []).map((row: any) => ({ id:row.products.id, name:row.products.name, description:row.products.description, price_cents:row.products.price_cents, image_url:row.products.image_url, available_today:row.available_today, sold_out:row.sold_out, category_id:row.products.category_id, category_name:row.products.categories.name }));
}
