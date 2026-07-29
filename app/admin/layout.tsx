import { Sidebar } from '@/components/admin/sidebar';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
export default async function AdminLayout({ children }: Readonly<{children:React.ReactNode}>) { const db=await createClient(); if (!db) return <div className="p-8 text-stone-600">Configure o Supabase para acessar o painel.</div>; const {data:{user}}=await db.auth.getUser(); if(!user) redirect('/login'); const {data:admin}=await db.from('admin_users').select('id').eq('id',user.id).maybeSingle(); if(!admin) redirect('/cardapio'); return <div className="min-h-screen bg-stone-50 md:flex"><Sidebar/><main className="min-w-0 flex-1 p-5 md:p-8">{children}</main></div>; }
