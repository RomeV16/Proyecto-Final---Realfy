import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Realfy',
  description: 'Administración de alquileres para inmobiliarias: contratos, liquidaciones, cobranza y rendiciones.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
