import { PublicMenu } from '@/components/public/public-menu';
import { getDailyMenu } from '@/lib/menu';

export const dynamic = 'force-dynamic';

export default async function CardapioPage() {
  let menu;
  try {
    menu = await getDailyMenu();
  } catch {
    return <main className="grid min-h-screen place-items-center bg-stone-50 p-5"><div role="alert" className="max-w-md rounded-2xl border bg-white p-8 text-center"><h1 className="text-2xl font-black">Cardápio indisponível</h1><p className="mt-3 text-stone-600">Não foi possível carregar o cardápio agora.</p><a href="/cardapio" className="mt-5 inline-block rounded-xl bg-brand-600 px-4 py-3 font-bold text-white">Tentar novamente</a></div></main>;
  }
  return <PublicMenu {...menu} />;
}
