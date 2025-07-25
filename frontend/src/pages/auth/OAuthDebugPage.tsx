import { useState } from 'react';

export default function OAuthDebugPage() {
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const testDirectNavigation = (provider: 'line' | 'google') => {
    addLog(`Testing direct navigation for ${provider}`);
    const url = `${window.location.origin}/api/oauth/${provider}`;
    addLog(`URL: ${url}`);
    
    // Method 1: window.location.href
    addLog('Attempting window.location.href...');
    window.location.href = url;
  };

  const testReplaceNavigation = (provider: 'line' | 'google') => {
    addLog(`Testing replace navigation for ${provider}`);
    const url = `${window.location.origin}/api/oauth/${provider}`;
    addLog(`URL: ${url}`);
    
    // Method 2: window.location.replace
    addLog('Attempting window.location.replace...');
    window.location.replace(url);
  };

  const testAnchorNavigation = (provider: 'line' | 'google') => {
    addLog(`Testing anchor navigation for ${provider}`);
    const url = `${window.location.origin}/api/oauth/${provider}`;
    addLog(`URL: ${url}`);
    
    // Method 3: Create and click anchor
    const a = document.createElement('a');
    a.href = url;
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const testFetch = async (provider: 'line' | 'google') => {
    addLog(`Testing fetch for ${provider}`);
    const url = `${window.location.origin}/api/oauth/${provider}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual'
      });
      
      addLog(`Response status: ${response.status}`);
      addLog(`Response type: ${response.type}`);
      
      const location = response.headers.get('Location');
      if (location) {
        addLog(`Redirect location: ${location}`);
      }
      
      // Check all headers
      response.headers.forEach((value, key) => {
        addLog(`Header ${key}: ${value}`);
      });
    } catch (error) {
      addLog(`Fetch error: ${error}`);
    }
  };

  const checkServiceWorker = async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      addLog(`Service workers found: ${registrations.length}`);
      
      registrations.forEach((reg, index) => {
        addLog(`SW ${index}: ${reg.scope}`);
        if (reg.active) {
          addLog(`SW ${index} state: ${reg.active.state}`);
        }
      });
    } else {
      addLog('Service Worker not supported');
    }
  };

  const unregisterServiceWorkers = async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
        addLog(`Unregistered SW: ${reg.scope}`);
      }
      addLog('All service workers unregistered. Reload the page.');
    }
  };

  const clearLogs = () => setLogs([]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">OAuth Debug Page</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Navigation Tests</h2>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h3 className="font-medium mb-2">LINE OAuth</h3>
              <div className="space-y-2">
                <button
                  onClick={() => testDirectNavigation('line')}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Test location.href
                </button>
                <button
                  onClick={() => testReplaceNavigation('line')}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Test location.replace
                </button>
                <button
                  onClick={() => testAnchorNavigation('line')}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Test anchor click
                </button>
                <button
                  onClick={() => testFetch('line')}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Test fetch
                </button>
              </div>
            </div>
            
            <div>
              <h3 className="font-medium mb-2">Google OAuth</h3>
              <div className="space-y-2">
                <button
                  onClick={() => testDirectNavigation('google')}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Test location.href
                </button>
                <button
                  onClick={() => testReplaceNavigation('google')}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Test location.replace
                </button>
                <button
                  onClick={() => testAnchorNavigation('google')}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Test anchor click
                </button>
                <button
                  onClick={() => testFetch('google')}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Test fetch
                </button>
              </div>
            </div>
          </div>
          
          <div className="border-t pt-4">
            <h3 className="font-medium mb-2">Service Worker</h3>
            <div className="space-x-2">
              <button
                onClick={checkServiceWorker}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Check SW
              </button>
              <button
                onClick={unregisterServiceWorkers}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Unregister All SW
              </button>
              <button
                onClick={clearLogs}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Clear Logs
              </button>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Debug Logs</h2>
          <div className="bg-gray-100 rounded p-4 h-96 overflow-y-auto font-mono text-sm">
            {logs.length === 0 ? (
              <p className="text-gray-500">No logs yet. Click a test button above.</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="mb-1">{log}</div>
              ))
            )}
          </div>
        </div>
        
        <div className="mt-6 text-sm text-gray-600">
          <p>Direct links to test:</p>
          <ul className="mt-2 space-y-1">
            <li>
              <a href="/api/oauth/line" className="text-blue-600 hover:underline">
                /api/oauth/line (direct link)
              </a>
            </li>
            <li>
              <a href="/api/oauth/google" className="text-blue-600 hover:underline">
                /api/oauth/google (direct link)
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}