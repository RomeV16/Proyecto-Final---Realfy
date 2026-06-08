import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    // Proxy de /api al backend para que el frontend lo consuma same-origin
    // (evita problemas de CORS y de cookies entre dominios).
    // En produccion se resuelve por la red privada de Railway via API_PROXY_TARGET;
    // en desarrollo apunta al NestJS local.
    const target =
      process.env.API_PROXY_TARGET || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
