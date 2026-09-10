export type AdminMenuCategory = { id: string; name: string; sort_order: number; active: boolean; updated_at: string };
export type AdminMenuAvailability = { id: string; product_id: string; date: string; available_today: boolean; sold_out: boolean; sort_order: number; updated_at: string };
export type AdminMenuOption = { id: string; product_id: string; name: string; required: boolean; min_choices: number; max_choices: number; updated_at: string };
export type AdminMenuAddon = { id: string; product_id: string; option_id: string | null; name: string; price_cents: number; active: boolean; sort_order: number; updated_at: string };
export type AdminMenuProduct = {
  id: string; category_id: string; name: string; description: string | null; price_cents: number;
  public_name: string; product_type: 'meal' | 'beverage'; small_price_cents: number | null; large_price_cents: number | null;
  image_url: string | null; sort_order: number; active: boolean; updated_at: string;
  availability: AdminMenuAvailability | null; options: AdminMenuOption[]; addons: AdminMenuAddon[];
};
export type AdminMenuData = { date: string; categories: AdminMenuCategory[]; products: AdminMenuProduct[] };
export type AdminMenuResult = { data: AdminMenuData; error?: never } | { data?: never; error: string; unauthorized?: boolean };
export type MenuMutationResult = { data: { message: string }; error?: never } | { data?: never; error: string; conflict?: boolean; unauthorized?: boolean };
