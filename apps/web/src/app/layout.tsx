import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Realfy',
  description: 'Gestión inmobiliaria inteligente',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
