import { CustomersCRM } from '@/components/admin/customers-crm';
import { loadCustomers } from './actions';

export const dynamic = 'force-dynamic';

export default async function ClientesPage() {
  return <CustomersCRM initial={await loadCustomers()} />;
}
