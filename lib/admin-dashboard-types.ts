import type { OrderStatus } from '@/lib/admin-order-types';

export type DashboardMetrics = { orders_today: number; revenue_today_cents: number; average_ticket_today_cents: number; customers_today: number; open_orders: number };
export type OperationalStatus = Extract<OrderStatus, 'new' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery'>;
export type DashboardStatusCounts = Record<OperationalStatus, number>;
export type DashboardRecentOrder = { id: string; order_number: number; customer_name_snapshot: string; created_at: string; status: OrderStatus; delivery_method: 'delivery' | 'pickup'; total_cents: number };
export type DashboardProduct = { name: string; quantity: number; revenue_cents: number };
export type DashboardSettings = { name: string; is_open: boolean; delivery_fee_cents: number; delivery_minutes_min: number | null; delivery_minutes_max: number | null };
export type AdminDashboard = { business_date: string; metrics: DashboardMetrics; status_counts: DashboardStatusCounts; top_products: DashboardProduct[]; recent_orders: DashboardRecentOrder[]; settings: DashboardSettings };
export type DashboardResult = { data: AdminDashboard; error?: never } | { data?: never; error: string; unauthorized?: boolean };
