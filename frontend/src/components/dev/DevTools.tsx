import { useEffect, useState } from 'react';

/**
 * Development tools component that shows helpful development information
 * Only renders in development mode
 */
export default function DevTools() {
  const [showDevInfo, setShowDevInfo] = useState(false);

  useEffect(() => {
    // Only show in development mode
    if (!import.meta.env?.DEV) return;

    // Check if React DevTools is installed
    const hasReactDevTools = !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    
    if (!hasReactDevTools) {
      // Show info about React DevTools only once per session
      const hasShownDevTools = sessionStorage.getItem('react-devtools-info-shown');
      if (!hasShownDevTools) {
        setShowDevInfo(true);
        sessionStorage.setItem('react-devtools-info-shown', 'true');
      }
    }
  }, []);

  // Don't render anything in production
  if (!import.meta.env?.DEV || !showDevInfo) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
      <div className="flex items-start space-x-2">
        <div className="flex-shrink-0">
          ⚛️
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-sm">React DevTools</h4>
          <p className="text-xs mt-1 opacity-90">
            Install React DevTools browser extension for better development experience
          </p>
          <div className="mt-2 flex space-x-2">
            <a
              href="https://reactjs.org/link/react-devtools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-blue-500 hover:bg-blue-400 px-2 py-1 rounded"
            >
              Install
            </a>
            <button
              onClick={() => setShowDevInfo(false)}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}