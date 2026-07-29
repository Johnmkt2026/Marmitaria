import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Operação Almoço', description: 'Cardápio e pedidos' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
