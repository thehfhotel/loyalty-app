/**
 * Custom Service Worker for Hotel Loyalty App
 * Handles push notifications and PWA OAuth flows
 */

// Import Workbox for precaching
import { precacheAndRoute } from 'workbox-precaching';

// Precache and route with injected manifest
precacheAndRoute(self.__WB_MANIFEST);

// Listen for push events
self.addEventListener('push', event => {
  console.log('Push message received:', event);

  let notificationData = {
    title: 'Hotel Loyalty App',
    body: 'You have a new notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'default',
    requireInteraction: false,
    data: {}
  };

  // Parse push data if available
  if (event.data) {
    try {
      const pushData = event.data.json();
      notificationData = {
        ...notificationData,
        ...pushData,
        icon: pushData.icon || '/icon-192.png',
        badge: pushData.badge || '/icon-192.png'
      };
    } catch (error) {
      console.error('Failed to parse push data:', error);
      notificationData.body = event.data.text() || notificationData.body;
    }
  }

  // Show notification
  const promiseChain = self.registration.showNotification(notificationData.title, {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    tag: notificationData.tag,
    requireInteraction: notificationData.requireInteraction,
    data: notificationData.data,
    actions: notificationData.actions || []
  });

  event.waitUntil(promiseChain);
});

// Listen for notification clicks
self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);

  event.notification.close();

  // Handle notification actions
  if (event.action) {
    console.log('Notification action clicked:', event.action);
    // Handle specific actions here
  }

  // Open the app
  const promiseChain = clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  }).then(windowClients => {
    // Check if app is already open
    for (let i = 0; i < windowClients.length; i++) {
      const client = windowClients[i];
      if (client.url.includes(self.location.origin)) {
        // App is already open, focus it
        return client.focus();
      }
    }

    // App is not open, open it
    const urlToOpen = event.notification.data?.url || '/dashboard';
    return clients.openWindow(self.location.origin + urlToOpen);
  });

  event.waitUntil(promiseChain);
});

// Listen for push subscription changes
self.addEventListener('pushsubscriptionchange', event => {
  console.log('Push subscription changed:', event);

  // Re-subscribe to push notifications
  const promiseChain = self.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: event.newSubscription?.options?.applicationServerKey
  }).then(newSubscription => {
    // Send new subscription to backend
    return fetch('/api/notifications/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscription: newSubscription.toJSON(),
        platform: getClientPlatform()
      })
    });
  });

  event.waitUntil(promiseChain);
});

// Handle message events from the app
self.addEventListener('message', event => {
  console.log('Service worker received message:', event.data);

  if (event.data && event.data.type === 'OAUTH_SUCCESS') {
    // Handle OAuth success in PWA context
    console.log('OAuth success received in service worker');
    
    // Notify all clients about OAuth success
    clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'OAUTH_SUCCESS_BROADCAST',
          data: event.data.data
        });
      });
    });
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Force service worker to take control
    self.skipWaiting();
  }
});

// Utility function to get client platform
function getClientPlatform() {
  const userAgent = self.navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return 'ios';
  } else if (/Android/i.test(userAgent)) {
    return 'android';
  } else {
    return 'web';
  }
}

// Background sync for offline notifications (if supported)
if ('sync' in self.registration) {
  self.addEventListener('sync', event => {
    console.log('Background sync event:', event.tag);
    
    if (event.tag === 'loyalty-app-sync') {
      // Handle background sync for notifications, OAuth state, etc.
      event.waitUntil(doBackgroundSync());
    }
  });
}

async function doBackgroundSync() {
  try {
    // Sync any pending OAuth states
    // Sync notifications
    // Update app data
    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

console.log('Hotel Loyalty App Service Worker loaded');