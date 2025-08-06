import React, { useState, useEffect, useRef } from 'react';
import { FiBell, FiCheck, FiX, FiTrash2, FiCheckCircle } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'system' | 'reward' | 'coupon' | 'survey' | 'profile';
  data?: Record<string, any>;
  readAt?: string;
  createdAt: string;
  expiresAt?: string;
}

interface NotificationSummary {
  total: number;
  unread: number;
  notifications: Notification[];
}

export default function NotificationCenter() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSummary>({
    total: 0,
    unread: 0,
    notifications: []
  });
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (isOpen && user) {
      fetchNotifications();
    }
  }, [isOpen, user]);

  const fetchNotifications = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/notifications?limit=10&includeRead=true', {
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        setNotifications(result.data);
      } else {
        console.error('Failed to fetch notifications');
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async (notificationIds: string[]) => {
    if (!user || notificationIds.length === 0) return;

    try {
      const response = await fetch('/api/notifications/mark-read', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notificationIds }),
      });

      if (response.ok) {
        // Update local state
        setNotifications(prev => ({
          ...prev,
          unread: Math.max(0, prev.unread - notificationIds.length),
          notifications: prev.notifications.map(notif => 
            notificationIds.includes(notif.id) 
              ? { ...notif, readAt: new Date().toISOString() }
              : notif
          )
        }));
      }
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!user || notifications.unread === 0) return;

    try {
      const response = await fetch('/api/notifications/mark-read', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markAll: true }),
      });

      if (response.ok) {
        // Update local state
        setNotifications(prev => ({
          ...prev,
          unread: 0,
          notifications: prev.notifications.map(notif => ({
            ...notif,
            readAt: notif.readAt || new Date().toISOString()
          }))
        }));
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    if (!user) return;

    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().accessToken}`,
        },
      });

      if (response.ok) {
        // Update local state
        const deletedNotification = notifications.notifications.find(n => n.id === notificationId);
        setNotifications(prev => ({
          total: prev.total - 1,
          unread: deletedNotification && !deletedNotification.readAt ? prev.unread - 1 : prev.unread,
          notifications: prev.notifications.filter(n => n.id !== notificationId)
        }));
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
      case 'reward':
        return '🎉';
      case 'coupon':
        return '🎫';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'profile':
        return '👤';
      case 'survey':
        return '📝';
      case 'system':
        return '⚙️';
      default:
        return 'ℹ️';
    }
  };

  const getNotificationColor = (type: Notification['type']) => {
    switch (type) {
      case 'success':
      case 'reward':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'coupon':
        return 'text-purple-600 bg-purple-50 border-purple-200';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'profile':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'survey':
        return 'text-indigo-600 bg-indigo-50 border-indigo-200';
      case 'system':
        return 'text-gray-600 bg-gray-50 border-gray-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 rounded-md"
        aria-label="Notifications"
      >
        <FiBell className="h-6 w-6" />
        {notifications.unread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-xs text-white rounded-full flex items-center justify-center font-semibold">
            {notifications.unread > 9 ? '9+' : notifications.unread}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg ring-1 ring-black ring-opacity-5 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {t('notifications.title', 'Notifications')}
              </h3>
              <div className="flex items-center space-x-2">
                {notifications.unread > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    {t('notifications.markAllRead', 'Mark all read')}
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <FiX className="h-5 w-5" />
                </button>
              </div>
            </div>
            {notifications.unread > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {t('notifications.unreadCount', '{{count}} unread', { count: notifications.unread })}
              </p>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-gray-500">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-2" />
                {t('notifications.loading', 'Loading...')}
              </div>
            ) : notifications.notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                <FiBell className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                <p>{t('notifications.empty', 'No notifications yet')}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`px-4 py-3 hover:bg-gray-50 transition-colors ${
                      !notification.readAt ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      {/* Icon */}
                      <div className="flex-shrink-0 mt-1">
                        <span className="text-lg" role="img" aria-label={notification.type}>
                          {getNotificationIcon(notification.type)}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className={`text-sm font-semibold ${
                              !notification.readAt ? 'text-gray-900' : 'text-gray-700'
                            }`}>
                              {notification.title}
                            </p>
                            <p className={`text-sm mt-1 ${
                              !notification.readAt ? 'text-gray-700' : 'text-gray-500'
                            }`}>
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center space-x-1 ml-2">
                            {!notification.readAt && (
                              <button
                                onClick={() => markAsRead([notification.id])}
                                className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                title={t('notifications.markRead', 'Mark as read')}
                              >
                                <FiCheck className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => deleteNotification(notification.id)}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title={t('notifications.delete', 'Delete')}
                            >
                              <FiTrash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Additional data display */}
                        {notification.data && (
                          <div className="mt-2">
                            {notification.data.coupon && (
                              <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getNotificationColor('coupon')}`}>
                                🎫 {notification.data.coupon.name}
                              </div>
                            )}
                            {notification.data.pointsAwarded && (
                              <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getNotificationColor('reward')} ml-2`}>
                                ⭐ +{notification.data.pointsAwarded} points
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.total > 10 && (
            <div className="px-4 py-3 border-t border-gray-200 text-center">
              <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                {t('notifications.viewAll', 'View all notifications')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}