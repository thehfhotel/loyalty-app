import { useAuthStore } from '../store/authStore';
import { FiUser, FiAward, FiUsers } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MainLayout from '../components/layout/MainLayout';

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  
  // Check user roles
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  return (
    <MainLayout title={t('dashboard.title')}>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Profile & Loyalty Card */}
            <Link
              to="/profile"
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <FiUser className="h-6 w-6 text-primary-600" />
                    </div>
                    <div className="ml-3">
                      <dt className="text-lg font-semibold text-gray-900">
                        {t('dashboard.myProfile')}
                      </dt>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 bg-gold-500 rounded-full flex items-center justify-center">
                      <span className="text-xs text-white font-bold">★</span>
                    </div>
                  </div>
                </div>
                <div>
                  <dd className="text-sm font-medium text-gray-500 mb-1">
                    {t('dashboard.manageProfile')}
                  </dd>
                  <dd className="text-sm font-medium text-gray-500">
                    {t('dashboard.manageLoyalty')}
                  </dd>
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
                      <dt className="text-lg font-semibold text-gray-900 truncate">
                        {t('dashboard.myCoupons')}
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-gray-500">
                        {t('dashboard.manageCoupons')}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>

            {/* Surveys Card */}
            <Link
              to="/surveys"
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 bg-purple-500 rounded flex items-center justify-center">
                      <span className="text-xs text-white font-bold">📝</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-lg font-semibold text-gray-900 truncate">
                        {t('dashboard.surveys')}
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-gray-500">
                        {t('dashboard.takeSurveys')}
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
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          {t('dashboard.loyaltyManagement')}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
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
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          {t('dashboard.couponManagement')}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
                          {t('dashboard.manageCouponsAdmin')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* Survey Management Card (Admin+ Only) */}
            {isAdmin && (
              <Link
                to="/admin/surveys"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="h-6 w-6 bg-purple-500 rounded flex items-center justify-center">
                        <span className="text-xs text-white font-bold">📊</span>
                      </div>
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          {t('dashboard.surveyManagement')}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
                          {t('dashboard.manageSurveysAdmin')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* User Management Card (Admin+ Only) */}
            {isAdmin && (
              <Link
                to="/admin/users"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <FiUsers className="h-6 w-6 text-blue-600" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          {t('dashboard.userManagement')}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
                          {t('dashboard.manageUsersAdmin')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* New Member Coupons Card (Admin+ Only) */}
            {isAdmin && (
              <Link
                to="/admin/new-member-coupons"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="h-6 w-6 bg-green-500 rounded flex items-center justify-center">
                        <span className="text-xs text-white font-bold">🎁</span>
                      </div>
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          New Member Coupons
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
                          Configure welcome coupons
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
    </MainLayout>
  );
}