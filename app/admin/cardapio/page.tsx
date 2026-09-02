import { MenuAdmin } from '@/components/admin/menu-admin';
import { loadAdminMenu } from './actions';

export const dynamic = 'force-dynamic';

export default async function CardapioAdminPage() {
  return <MenuAdmin initial={await loadAdminMenu()} />;
}
