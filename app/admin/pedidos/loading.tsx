export default function LoadingOrders() {
  return <div role="status" aria-busy="true"><h1 className="text-2xl font-black">Pedidos</h1><p className="mt-3 text-stone-600">Carregando pedidos...</p><div className="mt-6 grid gap-4 xl:grid-cols-2">{[1, 2].map(id => <div key={id} className="h-44 animate-pulse rounded-2xl border bg-white" />)}</div></div>;
}
