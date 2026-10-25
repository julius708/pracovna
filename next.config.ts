import type { NextConfig } from "next";

const SELF = 'https://pracovna.live-in.international';
// Staré adresy (bez /pracovna), na ktoré sa odkazujú nainštalované appky na telefónoch,
// zaregistrovaný service worker, Guesty webhook a odkazy v e-mailoch: fungujú ďalej.
const LEGACY = ['/sw.js', '/manifest.webmanifest', '/icons/:path*', '/api/:path*', '/health', '/auth/callback'];

const nextConfig: NextConfig = {
  basePath: '/pracovna',
  async redirects() {
    return [
      { source: '/', destination: '/pracovna', basePath: false, permanent: false },
      { source: '/login', destination: '/pracovna/login', basePath: false, permanent: false },
      { source: '/nove-heslo', destination: '/pracovna/nove-heslo', basePath: false, permanent: false },
    ];
  },
  async rewrites() {
    return LEGACY.map((source) => ({ source, destination: `${SELF}/pracovna${source}`, basePath: false }));
  },
};

export default nextConfig;
