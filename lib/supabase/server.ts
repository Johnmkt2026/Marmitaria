import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof store.set>[2] }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            store.set(name, value, options);
          });
        } catch {
          // O método setAll foi chamado a partir de um Server Component.
          // Isso pode ser ignorado se o middleware estiver atualizando sessões.
        }
      },
    },
  });
}
