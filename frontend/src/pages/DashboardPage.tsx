import { useAuthStore } from '../store/authStore';
import { FiUser, FiLogOut, FiToggleLeft, FiAward } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { getUserDisplayName } from '../utils/userHelpers';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  
  // Check user roles
  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">{t('dashboard.title')}</h1>
            <div className="flex items-center space-x-4">
              <LanguageSwitcher />
              <span className="text-sm text-gray-500">
                {t('dashboard.welcome', { name: getUserDisplayName(user) })}
              </span>
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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Profile Card */}
            <Link
              to="/profile"
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiUser className="h-6 w-6 text-primary-600" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">
                        {t('dashboard.myProfile')}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        {t('dashboard.manageProfile')}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>

            {/* Loyalty Points Card */}
            <Link
              to="/loyalty"
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 bg-gold-500 rounded-full flex items-center justify-center">
                      <span className="text-xs text-white font-bold">★</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">
                        {t('dashboard.loyaltyPoints')}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        {t('dashboard.manageLoyalty')}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>

            {/* Coupons Card */}
            <Link
              to="/coupons"
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 bg-green-500 rounded flex items-center justify-center">
                      <span className="text-xs text-white font-bold">🎫</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">
                        {t('dashboard.myCoupons')}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        {t('dashboard.manageCoupons')}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>

            {/* Loyalty Management Card (Admin+ Only) */}
            {isAdmin && (
              <Link
                to="/admin/loyalty"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <FiAward className="h-6 w-6 text-blue-600" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          {t('dashboard.loyaltyManagement')}
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-gray-900">
                          {t('dashboard.manageLoyaltyAdmin')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* Coupon Management Card (Admin+ Only) */}
            {isAdmin && (
              <Link
                to="/admin/coupons"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="h-6 w-6 bg-yellow-500 rounded flex items-center justify-center">
                        <span className="text-xs text-white font-bold">🎫</span>
                      </div>
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          {t('dashboard.couponManagement')}
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-gray-900">
                          {t('dashboard.manageCouponsAdmin')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* Feature Toggle Card (Super Admin Only) */}
            {isSuperAdmin && (
              <Link
                to="/admin/feature-toggles"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <FiToggleLeft className="h-6 w-6 text-purple-600" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          {t('dashboard.featureToggles')}
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-gray-900">
                          {t('dashboard.manageFeatures')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            )}
          </div>

          {/* Welcome Message */}
          <div className="mt-8 bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                {t('dashboard.welcomeMessage')}
              </h3>
              <div className="mt-2 max-w-xl text-sm text-gray-500">
                <p>
                  {t('dashboard.welcomeDescription')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}