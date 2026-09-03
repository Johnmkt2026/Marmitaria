import { WhatsAppCenter } from '@/components/admin/whatsapp-center';
import { getWhatsAppCenterResult } from '@/lib/admin-whatsapp';

export const dynamic = 'force-dynamic';

export default async function WhatsAppPage() {
  return <WhatsAppCenter initial={await getWhatsAppCenterResult()} />;
}
