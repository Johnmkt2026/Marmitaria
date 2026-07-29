import { MenuClient } from '@/components/public/menu-client';
import { getDailyMenu } from '@/lib/menu';
export const dynamic = 'force-dynamic';
export default async function CardapioPage() { const products = await getDailyMenu(); return <main className="min-h-screen"><header className="bg-brand-600 px-5 py-8 text-white"><div className="mx-auto max-w-6xl"><p className="text-sm font-medium opacity-90">Cardápio de hoje</p><h1 className="text-3xl font-bold">Operação Almoço</h1><div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-white/20 px-3 py-1">● Aberto</span><span className="rounded-full bg-white/20 px-3 py-1">Entrega em 35–50 min</span></div></div></header><div className="mx-auto max-w-6xl px-5 py-8"><MenuClient products={products} /></div></main>; }
