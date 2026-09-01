'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect('/login');
}
