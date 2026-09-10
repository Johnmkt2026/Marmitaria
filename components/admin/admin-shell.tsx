'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { logoutAction } from '@/app/admin/actions';

const links = [
  ['/admin', '⌂', 'Visão geral'],
  ['/admin/pedidos', '▤', 'Pedidos'],
  ['/admin/clientes', '♧', 'Clientes'],
  ['/admin/cardapio', '♨', 'Cardápio'],
  ['/admin/whatsapp', '◉', 'WhatsApp'],
  ['/admin/relatorios', '↗', 'Relatórios'],
  ['/admin/configuracoes', '⚙', 'Configurações'],
];

export function AdminShell({
  children,
  userEmail,
  restaurantName,
  isOpen,
}: {
  children: ReactNode;
  userEmail?: string;
  restaurantName?: string;
  isOpen?: boolean;
}) {
  const path = usePathname();

  return (
    <div className="min-h-screen bg-cream md:flex">
      <aside className="print:hidden border-b border-brand-900/10 bg-brand-900 text-white md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col md:justify-between md:border-b-0">
        <div>
          <div className="p-5">
            <Link href="/admin" className="text-xl font-black tracking-tight text-white">
              Temperando Sabores
            </Link>
            <p className="mt-1 text-xs text-emerald-100/70">Painel operacional</p>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1">
            {links.map(([href, icon, label]) => (
              <Link
                key={href}
                href={href}
                className={`block whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  path === href
                    ? 'bg-white font-bold text-brand-900 shadow-sm'
                    : 'text-emerald-50/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="mr-2 inline-block w-5 text-center" aria-hidden="true">{icon}</span>{label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Rodapé da Sidebar com perfil e logout */}
        <div className="hidden border-t border-white/10 p-4 md:block">
          {userEmail && (
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100/60">
                Conectado como
              </p>
              <p className="truncate text-xs font-medium text-emerald-50" title={userEmail}>
                {userEmail}
              </p>
            </div>
          )}
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
            >
              <span>Encerrar sessão</span>
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 md:ml-64 print:!ml-0">
        <header className="print:hidden sticky top-0 z-10 border-b border-stone-200/70 bg-cream/90 px-5 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div>
              <p className="font-black text-brand-900">{restaurantName || 'Temperando Sabores'}</p>
              <div className="mt-1 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-terracotta-500'}`}/><p className="text-xs font-bold text-stone-600">{isOpen ? 'ABERTO' : 'FECHADO'}</p></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-900 sm:inline-block">
                {path === '/admin' ? 'Dashboard da operação' : path === '/admin/pedidos' ? 'Pedidos da operação' : path === '/admin/clientes' ? 'Clientes da operação' : path === '/admin/cardapio' ? 'Cardápio da operação' : path === '/admin/configuracoes' ? 'Configurações da operação' : path === '/admin/relatorios' ? 'Relatórios da operação' : path === '/admin/whatsapp' ? 'Atendimento via WhatsApp' : 'Ambiente administrativo'}
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
