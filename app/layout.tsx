import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Temperando Sabores', description: 'Cardápio do dia e pedidos online da Temperando Sabores' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
