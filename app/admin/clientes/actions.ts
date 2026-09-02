'use server';

import { AdminAccessError } from '@/lib/admin-orders';
import { getAdminCustomers } from '@/lib/admin-customers';
import type { CustomersResult } from '@/lib/admin-customer-types';

export async function loadCustomers(): Promise<CustomersResult> {
  try { return { data: await getAdminCustomers() }; }
  catch (error) {
    return error instanceof AdminAccessError
      ? { error: error.message, unauthorized: true }
      : { error: 'Não foi possível atualizar os clientes. Tente novamente.' };
  }
}
