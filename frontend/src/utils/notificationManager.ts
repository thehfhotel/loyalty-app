import toast from 'react-hot-toast';

interface NotificationOptions {
  duration?: number;
  id?: string;
  [key: string]: any;
}

class NotificationManager {
  private static instance: NotificationManager;
  private activeNotifications = new Map<string, string>();
  private notificationDebounce = new Map<string, NodeJS.Timeout>();
  private readonly DEBOUNCE_TIME = 500; // 500ms debounce for duplicate messages

  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  private constructor() {
    // Private constructor to ensure singleton
  }

  private generateId(type: string, message: string): string {
    // Create a unique ID based on type and message content
    return `${type}-${message.toLowerCase().replace(/\s+/g, '-')}`;
  }

  private isDuplicate(id: string): boolean {
    return this.activeNotifications.has(id) || this.notificationDebounce.has(id);
  }

  private registerNotification(id: string): void {
    this.activeNotifications.set(id, id);
    
    // Set up debounce protection
    this.notificationDebounce.set(id, setTimeout(() => {
      this.notificationDebounce.delete(id);
    }, this.DEBOUNCE_TIME));
    
    // Auto-cleanup after duration
    setTimeout(() => {
      this.unregisterNotification(id);
    }, 5000); // Default 5s cleanup
  }

  private unregisterNotification(id: string): void {
    this.activeNotifications.delete(id);
    const debounceTimer = this.notificationDebounce.get(id);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      this.notificationDebounce.delete(id);
    }
  }

  showSuccess(message: string, options?: NotificationOptions): string | undefined {
    const id = options?.id ?? this.generateId('success', message);
    
    if (this.isDuplicate(id)) {
      console.debug(`[NotificationManager] Blocked duplicate success notification: ${message}`);
      return undefined;
    }

    toast.success(message, {
      duration: 4000,
      ...options,
      id,
    });

    this.registerNotification(id);
    return id;
  }

  showError(message: string, options?: NotificationOptions): string | undefined {
    const id = options?.id ?? this.generateId('error', message);
    
    if (this.isDuplicate(id)) {
      console.debug(`[NotificationManager] Blocked duplicate error notification: ${message}`);
      return undefined;
    }

    toast.error(message, {
      duration: 4000,
      ...options,
      id,
    });

    this.registerNotification(id);
    return id;
  }

  showInfo(message: string, options?: NotificationOptions): string | undefined {
    const id = options?.id ?? this.generateId('info', message);
    
    if (this.isDuplicate(id)) {
      console.debug(`[NotificationManager] Blocked duplicate info notification: ${message}`);
      return undefined;
    }

    toast(message, {
      duration: 4000,
      ...options,
      id,
    });

    this.registerNotification(id);
    return id;
  }

  showWarning(message: string, options?: NotificationOptions): string | undefined {
    const id = options?.id ?? this.generateId('warning', message);
    
    if (this.isDuplicate(id)) {
      console.debug(`[NotificationManager] Blocked duplicate warning notification: ${message}`);
      return undefined;
    }

    toast(message, {
      duration: 4000,
      icon: '⚠️',
      ...options,
      id,
    });

    this.registerNotification(id);
    return id;
  }

  dismiss(id: string): void {
    if (this.activeNotifications.has(id)) {
      toast.dismiss(id);
      this.unregisterNotification(id);
    }
  }

  dismissAll(): void {
    this.activeNotifications.forEach((_, id) => {
      toast.dismiss(id);
    });
    this.activeNotifications.clear();
    this.notificationDebounce.forEach(timer => clearTimeout(timer));
    this.notificationDebounce.clear();
  }

  // Get count of active notifications
  getActiveCount(): number {
    return this.activeNotifications.size;
  }

  // Check if a specific notification is active
  isActive(id: string): boolean {
    return this.activeNotifications.has(id);
  }
}

// Export singleton instance
export const notificationManager = NotificationManager.getInstance();

// Export convenience functions
export const notify = {
  success: (message: string, options?: NotificationOptions) => 
    notificationManager.showSuccess(message, options),
  error: (message: string, options?: NotificationOptions) => 
    notificationManager.showError(message, options),
  info: (message: string, options?: NotificationOptions) => 
    notificationManager.showInfo(message, options),
  warning: (message: string, options?: NotificationOptions) => 
    notificationManager.showWarning(message, options),
  dismiss: (id: string) => 
    notificationManager.dismiss(id),
  dismissAll: () => 
    notificationManager.dismissAll(),
};