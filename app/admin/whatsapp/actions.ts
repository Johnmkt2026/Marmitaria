'use server';

import { getWhatsAppCenterResult } from '@/lib/admin-whatsapp';
import type { WhatsAppCenterResult } from '@/lib/admin-whatsapp-types';

export async function loadWhatsAppCenter(): Promise<WhatsAppCenterResult> {
  return getWhatsAppCenterResult();
}
