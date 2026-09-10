'use client';

import { useActionState, use } from 'react';
import Link from 'next/link';
import { loginAction } from './actions';
import { Button } from '@/components/ui';

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const params = use(searchParams);
  const [state, formAction, isPending] = useActionState(loginAction, null);

  const initialError =
    params.error === 'unauthorized'
      ? 'Acesso negado: este usuário não possui privilégios de administrador.'
      : undefined;

  const errorMessage = state?.error || initialError;

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#dfe9d8,transparent_45%),#f8f2e7] p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-block">
            <span className="rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-900">
              Painel Operacional
            </span>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-stone-900">
              Temperando <span className="text-brand-600">Sabores</span>
            </h1>
          </Link>
          <p className="mt-2 text-sm text-stone-600">
            Acesso exclusivo para administradores
          </p>
        </div>

        <div className="rounded-3xl border border-stone-200 bg-white p-8 shadow-xl">
          <h2 className="text-xl font-bold text-stone-900">Fazer login</h2>
          <p className="mt-1 text-xs text-stone-500">
            Informe suas credenciais do Supabase Auth para continuar.
          </p>

          {errorMessage && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-800">
              {errorMessage}
            </div>
          )}

          <form action={formAction} className="mt-5 space-y-4">
            <input
              type="hidden"
              name="redirectTo"
              value={params.redirectTo || '/admin'}
            />

            <div>
              <label
                htmlFor="email"
                className="block text-xs font-bold text-stone-700 uppercase tracking-wider"
              >
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="seu-email@exemplo.com"
                className="mt-1.5 w-full rounded-xl border border-stone-300 bg-stone-50/50 p-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-bold text-stone-700 uppercase tracking-wider"
              >
                Senha
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-xl border border-stone-300 bg-stone-50/50 p-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <Button
              type="submit"
              disabled={isPending}
              className="mt-2 w-full py-3 text-center text-sm font-bold shadow-md shadow-brand-600/10"
            >
              {isPending ? 'Validando acesso...' : 'Entrar no painel'}
            </Button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/cardapio"
            className="text-xs font-semibold text-stone-500 hover:text-stone-900 transition"
          >
            ← Voltar para o cardápio público
          </Link>
        </div>
      </div>
    </main>
  );
}
