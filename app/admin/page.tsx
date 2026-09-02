import { AdminDashboard } from '@/components/admin/admin-dashboard';
import { getAdminDashboardResult } from '@/lib/admin-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  return <AdminDashboard initial={await getAdminDashboardResult()} />;
}
