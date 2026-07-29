import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Marmitaria23', description: 'Demonstração de operação para marmitaria' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
