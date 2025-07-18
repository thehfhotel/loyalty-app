import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showOfflineMessage, setShowOfflineMessage] = useState(false);
  const [showOnlineMessage, setShowOnlineMessage] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowOfflineMessage(false);
      setShowOnlineMessage(true);
      
      // Hide online message after 3 seconds
      setTimeout(() => {
        setShowOnlineMessage(false);
      }, 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowOnlineMessage(false);
      setShowOfflineMessage(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Show offline message immediately if already offline
    if (!navigator.onLine) {
      setShowOfflineMessage(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persistent offline indicator
  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white py-2 px-4 text-center text-sm font-medium safe-top">
        <div className="flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" />
          You're offline. Some features may be limited.
        </div>
      </div>
    );
  }

  // Temporary "back online" message
  if (showOnlineMessage) {
    return (
      <div className="fixed top-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80">
        <div className="bg-green-600 text-white py-3 px-4 rounded-lg shadow-lg animate-slide-up">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4" />
            <span className="font-medium">Back online!</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};