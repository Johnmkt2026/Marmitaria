'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { logoutAction } from '@/app/admin/actions';

const links = [
  ['/admin', 'Visão geral'],
  ['/admin/pedidos', 'Pedidos'],
  ['/admin/clientes', 'Clientes'],
  ['/admin/cardapio', 'Cardápio'],
  ['/admin/whatsapp', 'WhatsApp'],
  ['/admin/relatorios', 'Relatórios'],
  ['/admin/configuracoes', 'Configurações'],
];

export function AdminShell({
  children,
  userEmail,
}: {
  children: ReactNode;
  userEmail?: string;
}) {
  const path = usePathname();

  return (
    <div className="min-h-screen bg-stone-50 md:flex">
      <aside className="print:hidden border-b bg-white md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col md:justify-between md:border-b-0 md:border-r">
        <div>
          <div className="p-5">
            <Link href="/admin" className="text-xl font-black text-brand-600">
              Marmitaria23
            </Link>
            <p className="mt-1 text-xs text-stone-500">Painel operacional</p>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1">
            {links.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`block whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  path === href
                    ? 'bg-orange-100 font-bold text-brand-900'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Rodapé da Sidebar com perfil e logout */}
        <div className="hidden border-t border-stone-200 p-4 md:block">
          {userEmail && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                Conectado como
              </p>
              <p className="truncate text-xs font-medium text-stone-700" title={userEmail}>
                {userEmail}
              </p>
            </div>
          )}
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-red-50 hover:border-red-200 hover:text-red-700"
            >
              <span>Encerrar sessão</span>
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 md:ml-64 print:!ml-0">
        <header className="print:hidden sticky top-0 z-10 border-b bg-white/90 px-5 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div>
              <p className="font-bold">Marmitaria23</p>
              <p className="text-xs text-stone-500">Operação de hoje</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-orange-100 px-3 py-1.5 text-xs font-semibold text-brand-900 sm:inline-block">
                {path === '/admin/pedidos' ? 'Pedidos da operação' : path === '/admin/clientes' ? 'Clientes da operação' : path === '/admin/cardapio' ? 'Cardápio da operação' : 'Ambiente de demonstração — dados simulados'}
              </span>
              <div className="md:hidden">
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:text-red-600"
                  >
                    Sair
                  </button>
                </form>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl p-5 md:p-8">{children}</div>
      </main>
    </div>
  );
}
