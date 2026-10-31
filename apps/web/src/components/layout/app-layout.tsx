'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { MobileNav } from './mobile-nav';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <div className="contents print:hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      {/* Mobile nav drawer */}
      <div className="contents print:hidden">
        <MobileNav
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="contents print:hidden">
          <Header onMenuToggle={() => setMobileNavOpen(!mobileNavOpen)} />
        </div>
        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
