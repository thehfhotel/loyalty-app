import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { setupAxiosInterceptors } from './utils/axiosInterceptor';
import { TRPCProvider } from './utils/trpcProvider';
import { logger } from './utils/logger';
import './i18n/config';

// Set up global axios interceptors
setupAxiosInterceptors();

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </React.StrictMode>,
  );
} else {
  logger.error('Root element not found');
}