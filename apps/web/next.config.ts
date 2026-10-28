import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  ...(process.env.DOCKER_BUILD === 'true' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: path.join(__dirname, '../..'),
  poweredByHeader: false,
  devIndicators: false,
  experimental: { proxyTimeout: 180000 },
  async rewrites() {
    if (process.env.VERCEL && !process.env.API_ORIGIN) throw new Error('Set API_ORIGIN to the Render API HTTPS origin before deploying.');
    const origin = (process.env.API_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '');
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('API_ORIGIN must be an HTTP(S) origin without a path or credentials.');
    if (process.env.VERCEL && parsed.protocol !== 'https:') throw new Error('Vercel requires an HTTPS API_ORIGIN.');
    return ['rag', 'auth'].map(area => ({ source: `/api/${area}/:path*`, destination: `${origin}/${area}/:path*` }));
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] }];
  }
};
export default config;
