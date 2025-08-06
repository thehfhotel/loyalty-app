import { ReactNode } from 'react';
import { useAuthStore } from '../../store/authStore';
import { FiLogOut } from 'react-icons/fi';
import { getUserDisplayName } from '../../utils/userHelpers';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../LanguageSwitcher';
import ProfileCompletionBanner from '../profile/ProfileCompletionBanner';
import DashboardButton from '../navigation/DashboardButton';
import NotificationCenter from '../notifications/NotificationCenter';

interface MainLayoutProps {
  children: ReactNode;
  title: string;
  showProfileBanner?: boolean;
  showDashboardButton?: boolean;
}

export default function MainLayout({ children, title, showProfileBanner = true, showDashboardButton = false }: MainLayoutProps) {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Profile Completion Banner */}
      {showProfileBanner && <ProfileCompletionBanner />}
      
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            <div className="flex items-center space-x-4">
              <LanguageSwitcher />
              <span className="text-sm text-gray-500">
                {t('dashboard.welcome', { name: getUserDisplayName(user) })}
              </span>
              {showDashboardButton && (
                <DashboardButton variant="outline" size="md" />
              )}
              <NotificationCenter />
              <button
                onClick={logout}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <FiLogOut className="mr-2 h-4 w-4" />
                {t('common.logout')}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {children}
        </div>
      </main>
    </div>
  );
}