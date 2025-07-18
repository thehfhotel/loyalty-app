import React, { useState } from 'react';
import { Bell, Menu, Search, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/Button';

export const Header: React.FC = () => {
  const { user } = useAuthStore();
  const [showSearch, setShowSearch] = useState(false);
  const [notifications] = useState(3); // Mock notification count

  return (
    <header className="bg-white border-b border-gray-200 safe-top">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6">
        {/* Mobile Menu Button & Title */}
        <div className="flex items-center mobile-only">
          <button className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors mr-2">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            Hotel Loyalty
          </h1>
        </div>

        {/* Desktop Page Title */}
        <div className="desktop-only">
          <h1 className="text-xl font-semibold text-gray-900">
            Welcome back, {user?.firstName}!
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage your loyalty rewards and benefits
          </p>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Search Toggle - Mobile */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="mobile-only p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Toggle search"
          >
            {showSearch ? (
              <X className="w-5 h-5" />
            ) : (
              <Search className="w-5 h-5" />
            )}
          </button>

          {/* Search - Desktop */}
          <div className="desktop-only relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search rewards, coupons..."
              className="w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm focus:bg-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            />
          </div>

          {/* Notifications */}
          <button className="relative p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors">
            <Bell className="w-5 h-5" />
            {notifications > 0 && (
              <span className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {notifications > 9 ? '9+' : notifications}
              </span>
            )}
          </button>

          {/* Profile Avatar - Desktop */}
          <div className="desktop-only ml-2">
            <button className="flex items-center p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-sm font-medium text-primary-600">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Search Bar */}
      {showSearch && (
        <div className="mobile-only border-t border-gray-200 p-4 animate-slide-up">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search rewards, coupons..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm focus:bg-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              autoFocus
            />
          </div>
        </div>
      )}
    </header>
  );
};