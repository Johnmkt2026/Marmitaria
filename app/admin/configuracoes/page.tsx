import { SettingsAdmin } from '@/components/admin/settings-admin';
import { loadAdminSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  return <SettingsAdmin initial={await loadAdminSettings()} />;
}
