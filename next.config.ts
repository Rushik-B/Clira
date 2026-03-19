import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  env: {
    NEXT_PUBLIC_USE_MOCK_DATA_QUEUE: process.env.NEXT_PUBLIC_USE_MOCK_DATA_QUEUE || 'false',
    NEXT_PUBLIC_USE_MOCK_DATA_LABEL_QUEUE: process.env.NEXT_PUBLIC_USE_MOCK_DATA_LABEL_QUEUE || 'false',
  },

  compiler: {
    removeConsole: isProduction ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // Support for WASM files in production
  serverExternalPackages: ['fasttext.wasm'],
};

export default nextConfig;
