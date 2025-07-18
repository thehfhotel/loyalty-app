import React, { useState, useEffect } from 'react';
import { X, Download, Smartphone } from 'lucide-react';

export const PWAInstallPrompt: React.FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isInWebAppiOS = (window.navigator as any).standalone === true;
    
    if (isStandalone || isInWebAppiOS) {
      setIsInstalled(true);
      return;
    }

    // Listen for PWA install events
    const handleInstallAvailable = () => {
      setIsInstallable(true);
      // Show prompt after a delay to not be intrusive
      setTimeout(() => {
        setShowPrompt(true);
      }, 5000);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setIsInstallable(false);
    };

    window.addEventListener('pwa-install-available', handleInstallAvailable);
    window.addEventListener('pwa-installed', handleInstalled);

    return () => {
      window.removeEventListener('pwa-install-available', handleInstallAvailable);
      window.removeEventListener('pwa-installed', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (window.showInstallPrompt) {
      await window.showInstallPrompt();
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Don't show again for this session
    sessionStorage.setItem('pwa-prompt-dismissed', 'true');
  };

  // Don't show if already installed or dismissed this session
  if (isInstalled || !isInstallable || !showPrompt) {
    return null;
  }

  // Check if dismissed this session
  if (sessionStorage.getItem('pwa-prompt-dismissed')) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-96">
      <div className="card animate-slide-up p-4 border-primary-200 bg-gradient-to-r from-primary-50 to-secondary-50">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center">
            <div className="bg-primary-100 p-2 rounded-lg mr-3">
              <Smartphone className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Install App</h3>
              <p className="text-sm text-gray-600">Get the full experience</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            aria-label="Dismiss install prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <p className="text-sm text-gray-700 mb-4">
          Install our app for faster access, offline support, and push notifications.
        </p>
        
        <div className="flex gap-2">
          <button
            onClick={handleInstall}
            className="btn-primary btn-sm flex-1 gap-2"
          >
            <Download className="w-4 h-4" />
            Install App
          </button>
          <button
            onClick={handleDismiss}
            className="btn-ghost btn-sm px-4"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
};