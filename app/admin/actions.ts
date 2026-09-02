'use server';
import { redirect } from 'next/navigation';
import { getAdminDashboardResult } from '@/lib/admin-dashboard';
import type { DashboardResult } from '@/lib/admin-dashboard-types';
import { createClient } from '@/lib/supabase/server';

export async function logoutAction(): Promise<void> {
  const db = await createClient();
  if (db) await db.auth.signOut();
  redirect('/login');
}

export async function loadDashboard(): Promise<DashboardResult> { return getAdminDashboardResult(); }
