import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

/**
 * Shell de la app autenticada: sidebar de navegación + header + área de contenido.
 * Los providers (auth, react-query, tours) se integran en items posteriores.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
