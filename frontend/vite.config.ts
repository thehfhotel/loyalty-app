import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

const resolvePort = () => {
  const portSources = [
    process.env.PORT,
    process.env.FRONTEND_PORT,
    process.env.VITE_PORT,
  ];
  for (const value of portSources) {
    if (!value) continue;
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 3000;
};

const devServerPort = resolvePort();
const previewServerPort = Number(process.env.PREVIEW_PORT ?? devServerPort);

// Calculate proxy target for API requests
// VITE_API_URL is used to configure the proxy target, not for direct browser requests
const apiUrl = process.env.VITE_API_URL || process.env.BACKEND_URL;
const proxyTarget = apiUrl?.replace('/api', '') || 'http://localhost:5001';

// Log proxy configuration for debugging in E2E and development
console.log('[vite.config.ts] Proxy configuration:');
console.log('  VITE_API_URL:', process.env.VITE_API_URL);
console.log('  BACKEND_URL:', process.env.BACKEND_URL);
console.log('  Proxy target:', proxyTarget);

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icon-192.png', 'icon-512.png'],
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw-custom.js',
      manifest: {
        name: 'Hotel Loyalty App',
        short_name: 'Loyalty',
        description: 'Hotel Loyalty Program Management',
        theme_color: '#1e40af',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        categories: ['travel', 'business'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallbackDenylist: [/^\/api\/oauth/],
        // Remove additionalManifestEntries to prevent duplicate cache entries
        // The sw-custom.js file is already included in the build process
        runtimeCaching: [
          {
            // Dynamic pattern - matches API calls in any environment (dev/prod)
            // Excludes OAuth endpoints to prevent caching auth flows
            urlPattern: ({ url }) => {
              return url.pathname.startsWith('/api/') &&
                     !url.pathname.startsWith('/api/oauth');
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: devServerPort,
    host: true,
    allowedHosts: [
      'localhost',
      'loyalty.saichon.com',
      '.saichon.com'  // Allow all subdomains of saichon.com
    ],
    proxy: {
      '/api': {
        // Use calculated proxy target from environment
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('[vite proxy] Error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('[vite proxy] Request:', req.method, req.url, '->', proxyTarget + req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite proxy] Response:', req.method, req.url, proxyRes.statusCode);
          });
        }
      }
    }
  },
  preview: {
    port: previewServerPort,
    host: true,
    allowedHosts: [
      'localhost',
      'loyalty.saichon.com',
      '.saichon.com'  // Allow all subdomains of saichon.com
    ]
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: process.env.NODE_ENV === 'development',
    // Strip console.log/warn/debug in production (keep console.error for critical issues)
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['react-icons', 'react-hot-toast']
        }
      }
    }
  },
  esbuild: {
    // Remove console.log, console.warn, console.debug, console.info in production
    // Keep console.error for critical error reporting
    pure: process.env.NODE_ENV === 'production'
      ? ['console.log', 'console.warn', 'console.debug', 'console.info']
      : [],
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __DOMAIN__: JSON.stringify(process.env.DOMAIN || 'localhost')
  }
})
