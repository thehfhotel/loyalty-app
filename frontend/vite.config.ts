import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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

export default defineConfig({
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
        // Use environment variable or default to dev port 5001
        target: process.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5001',
        changeOrigin: true,
        secure: false
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
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __DOMAIN__: JSON.stringify(process.env.DOMAIN || 'localhost')
  }
})
