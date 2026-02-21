import { useState, useEffect, useRef } from 'react';
import { FiBell, FiCheck, FiX, FiTrash2 } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useMutation } from '@tanstack/react-query';
import { inAppNotificationService } from '../../services/inAppNotificationService';
import type { Notification, NotificationType } from '../../types/notification';

export default function NotificationCenter() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications using React Query
  const {
    data: notificationsData,
    isLoading,
    refetch: refetchNotifications
  } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => inAppNotificationService.getNotifications(1, 10, true),
    enabled: !!user,
  });

  // Mutations
  const markAsReadMutation = useMutation({
    mutationFn: ({ notificationIds }: { notificationIds: string[] }) =>
      inAppNotificationService.markMultipleAsRead(notificationIds),
    onSuccess: () => { refetchNotifications(); },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => inAppNotificationService.markAllAsRead(),
    onSuccess: () => { refetchNotifications(); },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: ({ notificationId }: { notificationId: string }) =>
      inAppNotificationService.deleteNotification(notificationId),
    onSuccess: () => { refetchNotifications(); },
  });

  const notifications: Notification[] = notificationsData?.notifications ?? [];
  const unreadCount = notifications.filter(n => !n.readAt).length;
  const totalCount = notificationsData?.pagination?.total ?? 0;

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

  // Refresh notifications and mark as read when dropdown opens
  useEffect(() => {
    if (isOpen && user) {
      refetchNotifications();
      // Auto-mark all as read when user opens the dropdown
      if (unreadCount > 0) {
        markAllAsReadMutation.mutate();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user]);

  const markAsRead = async (notificationIds: string[]) => {
    if (!user || notificationIds.length === 0) {return;}

    try {
      await markAsReadMutation.mutateAsync({ notificationIds });
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!user || unreadCount === 0) {return;}

    try {
      await markAllAsReadMutation.mutateAsync();
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    if (!user) {return;}

    try {
      await deleteNotificationMutation.mutateAsync({ notificationId });
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const getNotificationIcon = (type: NotificationType) => {
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
      case 'tier_change':
        return '⭐';
      case 'points':
        return '💰';
      default:
        return 'ℹ️';
    }
  };

  const getNotificationColor = (type: NotificationType) => {
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
      case 'tier_change':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'points':
        return 'text-green-600 bg-green-50 border-green-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  if (!user) {return null;}

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 rounded-md"
        aria-label="Notifications"
      >
        <FiBell className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-xs text-white rounded-full flex items-center justify-center font-semibold">
            {unreadCount > 9 ? '9+' : unreadCount}
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
                {unreadCount > 0 && (
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
            {unreadCount > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {t('notifications.unreadCount', '{{count}} unread', { count: unreadCount })}
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
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                <FiBell className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                <p>{t('notifications.empty', 'No notifications yet')}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
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
                            }`}
                            >
                              {notification.title}
                            </p>
                            <p className={`text-sm mt-1 ${
                              !notification.readAt ? 'text-gray-700' : 'text-gray-500'
                            }`}
                            >
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
                            {(() => {
                              const coupon = notification.data?.coupon;
                              if (coupon && typeof coupon === 'object' && 'name' in coupon) {
                                const couponName = (coupon as { name: unknown }).name;
                                if (typeof couponName === 'string') {
                                  return (
                                    <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getNotificationColor('coupon')}`}>
                                      🎫 {couponName}
                                    </div>
                                  );
                                }
                              }
                              return null;
                            })()}
                            {(() => {
                              const points = notification.data?.pointsAwarded;
                              if (typeof points === 'number') {
                                return (
                                  <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getNotificationColor('reward')} ml-2`}>
                                    ⭐ +{points} points
                                  </div>
                                );
                              }
                              return null;
                            })()}
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
          {totalCount > 10 && (
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