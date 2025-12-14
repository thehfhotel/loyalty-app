/* eslint-disable security/detect-object-injection -- Safe object property access with validated keys */
/**
 * PWA Push Notification Service
 * Handles push notifications for the loyalty app PWA
 */

import { detectPWA } from '../utils/pwaUtils';
import { API_BASE_URL } from '../utils/apiConfig';
import { logger } from '../utils/logger';

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  data?: unknown;
  actions?: { action: string; title: string; icon?: string }[];
}

export class NotificationService {
  private static instance: NotificationService;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private vapidPublicKey: string | null = null;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Initialize notification service with service worker
   */
  async initialize(): Promise<boolean> {
    try {
      const pwaInfo = detectPWA();

      if (!pwaInfo.isPWA || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        logger.log('Push notifications not supported in this environment');
        return false;
      }

      // Wait for service worker to be ready
      this.swRegistration = await navigator.serviceWorker.ready;
      
      // Get VAPID public key from backend
      await this.fetchVapidPublicKey();

      return true;
    } catch (error) {
      logger.error('Failed to initialize notification service:', error);
      return false;
    }
  }

  /**
   * Fetch VAPID public key from backend
   */
  private async fetchVapidPublicKey(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/notifications/vapid-key`);
      if (response.ok) {
        const data = await response.json();
        this.vapidPublicKey = data.publicKey;
      }
    } catch (error) {
      logger.error('Failed to fetch VAPID public key:', error);
    }
  }

  /**
   * Request permission for notifications
   */
  async requestPermission(): Promise<boolean> {
    try {
      if (!('Notification' in window)) {
        logger.log('Notifications not supported');
        return false;
      }

      if (Notification.permission === 'granted') {
        return true;
      }

      if (Notification.permission === 'denied') {
        logger.log('Notification permission denied');
        return false;
      }

      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      logger.error('Failed to request notification permission:', error);
      return false;
    }
  }

  /**
   * Subscribe to push notifications
   */
  async subscribeToPush(userId: string): Promise<boolean> {
    try {
      if (!this.swRegistration || !this.vapidPublicKey) {
        logger.error('Service worker or VAPID key not available');
        return false;
      }

      const permission = await this.requestPermission();
      if (!permission) {
        return false;
      }

      // Check if already subscribed
      const existingSubscription = await this.swRegistration.pushManager.getSubscription();
      if (existingSubscription) {
        // Send existing subscription to backend
        await this.sendSubscriptionToBackend(userId, existingSubscription);
        return true;
      }

      // Create new subscription
      const subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey) as BufferSource
      });

      // Send subscription to backend
      await this.sendSubscriptionToBackend(userId, subscription);

      logger.log('Successfully subscribed to push notifications');
      return true;
    } catch (error) {
      logger.error('Failed to subscribe to push notifications:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribeFromPush(): Promise<boolean> {
    try {
      if (!this.swRegistration) {
        return false;
      }

      const subscription = await this.swRegistration.pushManager.getSubscription();
      if (!subscription) {
        return true;
      }

      const success = await subscription.unsubscribe();
      
      if (success) {
        // Notify backend about unsubscription
        await this.removeSubscriptionFromBackend(subscription);
      }

      return success;
    } catch (error) {
      logger.error('Failed to unsubscribe from push notifications:', error);
      return false;
    }
  }

  /**
   * Send subscription to backend
   */
  private async sendSubscriptionToBackend(userId: string, subscription: PushSubscription): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/notifications/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({
          userId,
          subscription: subscription.toJSON(),
          platform: detectPWA().isIOS ? 'ios' : detectPWA().isAndroid ? 'android' : 'web'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save subscription on backend');
      }
    } catch (error) {
      logger.error('Failed to send subscription to backend:', error);
      throw error;
    }
  }

  /**
   * Remove subscription from backend
   */
  private async removeSubscriptionFromBackend(subscription: PushSubscription): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/notifications/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({
          subscription: subscription.toJSON()
        })
      });
    } catch (error) {
      logger.error('Failed to remove subscription from backend:', error);
    }
  }

  /**
   * Show local notification (for testing or immediate notifications)
   */
  async showNotification(options: NotificationOptions): Promise<void> {
    try {
      if (!this.swRegistration) {
        throw new Error('Service worker not registered');
      }

      const permission = await this.requestPermission();
      if (!permission) {
        throw new Error('Notification permission not granted');
      }

      await this.swRegistration.showNotification(options.title, {
        body: options.body,
        icon: options.icon ?? '/icon-192.png',
        badge: options.badge ?? '/icon-192.png',
        tag: options.tag,
        requireInteraction: options.requireInteraction,
        data: options.data,
        ...(options.actions && { actions: options.actions })
      });
    } catch (error) {
      logger.error('Failed to show notification:', error);
      throw error;
    }
  }

  /**
   * Check if notifications are supported and enabled
   */
  isEnabled(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  /**
   * Get current permission status
   */
  getPermissionStatus(): NotificationPermission | 'unsupported' {
    if (!('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  /**
   * Convert VAPID key from base64 to Uint8Array
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();