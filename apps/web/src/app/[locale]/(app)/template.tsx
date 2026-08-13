'use client';

/**
 * Per-navigation template — remounts on every route change inside the app
 * shell, replaying a soft blur-up transition on the page content while the
 * sidebar and header stay put.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
