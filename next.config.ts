import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_USE_MOCK_DATA_QUEUE: process.env.NEXT_PUBLIC_USE_MOCK_DATA_QUEUE || 'false',
    NEXT_PUBLIC_USE_MOCK_DATA_LABEL_QUEUE: process.env.NEXT_PUBLIC_USE_MOCK_DATA_LABEL_QUEUE || 'false',
  },

  compiler: {
    removeConsole: isProduction ? {
      exclude: ['error', 'warn'],
    } : false,
  },

  webpack: (config, { isServer }) => {
    // Exclude the landing-page directory from webpack processing
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/src/components/landing/**']
    };

    
    // Configure WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    // Exclude server-only packages from client-side bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        buffer: false,
        util: false,
        url: false,
        querystring: false,
        http: false,
        https: false,
        zlib: false,
        net: false,
        tls: false,
        child_process: false,
      };

      // Exclude Node.js and server-only modules from client bundle
      config.externals = [
        ...(config.externals || []),
        '@aws-sdk/client-s3',
        '@aws-sdk/lib-storage',
        'tmp',
      ];
    }

    return config;
  },
  
  // Support for WASM files in production
  serverExternalPackages: ['fasttext.wasm'],
};

export default nextConfig;
