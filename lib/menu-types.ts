export type MenuAddon = { id: string; product_id: string; option_id: string | null; name: string; price_cents: number };
export type MenuOption = { id: string; product_id: string; name: string; required: boolean; min_choices: number; max_choices: number };
export type MenuCategory = { id: string; name: string };
export type MenuProduct = {
  id: string; category_id: string; name: string; description: string | null; product_type: 'meal' | 'beverage';
  price_cents: number; small_price_cents: number | null; large_price_cents: number | null; image_url: string | null; sold_out: boolean;
  options: MenuOption[]; addons: MenuAddon[];
};
export type RestaurantSettings = {
  name: string; is_open: boolean; delivery_fee_cents: number;
  delivery_minutes_min: number | null; delivery_minutes_max: number | null;
};
export type DailyMenu = { restaurant: RestaurantSettings; categories: MenuCategory[]; products: MenuProduct[] };
export type OrderReceipt = {
  order_id: string; order_number: number; subtotal_cents: number; delivery_fee_cents: number; total_cents: number;
  items: Array<{ product_id: string; name: string; size: 'small' | 'large' | null; unit_price_cents: number; quantity: number; notes: string | null; addons: Array<{ name: string; unit_price_cents: number; quantity: number }> }>;
};
