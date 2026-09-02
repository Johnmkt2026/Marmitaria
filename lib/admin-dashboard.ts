import 'server-only';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import type { AdminDashboard, DashboardResult } from '@/lib/admin-dashboard-types';

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const db = await requireAdminClient();
  const { data, error } = await db.rpc('get_admin_dashboard');
  if (error || !data) throw new Error('Falha ao carregar indicadores');
  return data as AdminDashboard;
}

export async function getAdminDashboardResult(): Promise<DashboardResult> {
  try { return { data: await getAdminDashboard() }; }
  catch (error) {
    return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível carregar o dashboard.' };
  }
}
