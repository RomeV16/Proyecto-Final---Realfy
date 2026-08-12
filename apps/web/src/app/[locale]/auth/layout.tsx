export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.1fr] bg-[var(--color-bg)]">
      {/* Left — form column on warm paper */}
      <div className="relative flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-12">
        <div className="absolute top-8 left-6 sm:left-12 lg:left-20 flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white font-display italic text-lg">
            R
          </span>
          <span className="wordmark text-[1.35rem]">Realfy</span>
        </div>

        <div className="w-full max-w-sm mx-auto page-enter">{children}</div>

        <p className="absolute bottom-8 left-6 sm:left-12 lg:left-20 text-xs text-[var(--color-muted)]">
          © Realfy · Administración inmobiliaria
        </p>
      </div>

      {/* Right — full-bleed editorial image panel */}
      <div className="relative hidden lg:block overflow-hidden bg-gradient-auth">
        <img
          src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1500&q=80"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-90 animate-ken-burns"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a140d] via-[#1a140d]/35 to-[#1a140d]/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1a140d]/40 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-14 xl:p-20">
          <p className="eyebrow text-white/70">Realfy · 2026</p>
          <p className="font-display italic text-white text-3xl xl:text-[2.6rem] leading-[1.1] mt-4 max-w-lg [text-wrap:balance]">
            La forma más serena de administrar cada propiedad, contrato y persona.
          </p>
          <div className="mt-8 h-px w-16 bg-white/40" />
          <p className="mt-5 text-sm text-white/70 max-w-sm leading-relaxed">
            Cartera, alquileres por IPC, liquidaciones y portal de inquilinos en
            un solo lugar.
          </p>
        </div>
      </div>
    </div>
  );
}
