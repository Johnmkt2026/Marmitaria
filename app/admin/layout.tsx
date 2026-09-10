import { AdminShell } from '@/components/admin/admin-shell';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  if (!supabase) {
    redirect('/login');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) {
    await supabase.auth.signOut();
    redirect('/login?error=unauthorized');
  }

  const { data: settings } = await supabase
    .from('restaurant_settings')
    .select('name,is_open')
    .limit(1)
    .maybeSingle<{ name: string; is_open: boolean }>();

  return <AdminShell userEmail={user.email ?? undefined} restaurantName={settings?.name} isOpen={settings?.is_open}>{children}</AdminShell>;
}
