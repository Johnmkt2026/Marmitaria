import Link from 'next/link';

export default function Home() {
  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#ffedd5,transparent_45%),#fafaf9] p-5">
    <section className="max-w-2xl text-center">
      <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-bold text-brand-900">Comida caseira, feita hoje</span>
      <h1 className="mt-6 text-5xl font-black tracking-tight text-stone-900 sm:text-7xl">Temperando <span className="text-brand-600">Sabores</span></h1>
      <p className="mx-auto mt-5 max-w-lg text-lg text-stone-600">Escolha seu prato, personalize e faça seu pedido online.</p>
      <Link href="/pedir" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-7 py-3 font-bold text-white transition hover:bg-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Ver cardápio e pedir</Link>
      <p className="mt-8 text-sm text-stone-500">Entrega ou retirada, conforme a disponibilidade da operação.</p>
    </section>
  </main>;
}
