'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe sua senha.'),
  redirectTo: z.string().optional(),
});

export type LoginState = {
  error?: string;
};

export async function loginAction(
  prevState: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const rawEmail = formData.get('email');
  const rawPassword = formData.get('password');
  const rawRedirectTo = formData.get('redirectTo');

  const parsed = loginSchema.safeParse({
    email: rawEmail,
    password: rawPassword,
    redirectTo: rawRedirectTo || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || 'Dados de login inválidos.' };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { error: 'Serviço de autenticação não configurado no servidor.' };
  }

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (authError || !authData.user) {
    return { error: 'E-mail ou senha incorretos.' };
  }

  const { data: isAdmin, error: rpcError } = await supabase.rpc('is_admin');

  if (rpcError || !isAdmin) {
    await supabase.auth.signOut();
    return {
      error: 'Acesso negado: este usuário não possui privilégios de administrador.',
    };
  }

  const destination =
    parsed.data.redirectTo && parsed.data.redirectTo.startsWith('/admin')
      ? parsed.data.redirectTo
      : '/admin';

  redirect(destination);
}
