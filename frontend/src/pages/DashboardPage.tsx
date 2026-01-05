import { useAuthStore } from '../store/authStore';
import { FiUser, FiAward, FiUsers, FiGift, FiMail, FiCalendar } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MainLayout from '../components/layout/MainLayout';
import LoyaltyCarousel from '../components/loyalty/LoyaltyCarousel';
import { trpc } from '../hooks/useTRPC';

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);

  // Check user roles
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // Use tRPC hooks for data fetching
  const { data: loyaltyStatus, isLoading: loyaltyLoading, error: loyaltyError } = trpc.loyalty.getStatus.useQuery({});
  const { data: transactionsData } = trpc.loyalty.getTransactions.useQuery({
    page: 1,
    pageSize: 10
  });

  const transactions = transactionsData?.transactions ?? [];

  if (loyaltyLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" data-testid="dashboard-loading">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600" />
          <p className="mt-4 text-gray-600">{t('profile.loading')}</p>
        </div>
      </div>
    );
  }

  // Show error state if query failed - for debugging
  if (loyaltyError) {
    return (
      <MainLayout title={t('dashboard.title', { name: user?.firstName ?? '' })}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6" data-testid="loyalty-error">
          <h2 className="text-lg font-semibold text-red-800 mb-2">{t('common.error')}</h2>
          <p className="text-red-600">{loyaltyError.message || 'Failed to load loyalty status'}</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title={t('dashboard.title', { name: user?.firstName ?? '' })}>
          {/* Membership Tier Display */}
          {loyaltyStatus && (
            <div className="mb-6 bg-white shadow rounded-lg border-l-4" style={{ borderLeftColor: loyaltyStatus.tier_color }}>
              <div className="px-4 py-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="p-3 rounded-lg" style={{ backgroundColor: `${loyaltyStatus.tier_color}20` }}>
                      <FiGift className="w-8 h-8" style={{ color: loyaltyStatus.tier_color }} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900" data-testid="dashboard-tier">
                        {t('loyalty.tier')} {loyaltyStatus.tier_name}
                      </h2>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-2xl font-bold" style={{ color: loyaltyStatus.tier_color }}>
                          {loyaltyStatus.total_nights ?? 0}
                        </div>
                        <div className="text-sm text-gray-600">
                          {(loyaltyStatus.total_nights ?? 0) === 1 ? t('loyalty.night') : t('loyalty.nights')}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {t('loyalty.tierEligibility')}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold" style={{ color: loyaltyStatus.tier_color }} data-testid="dashboard-points">
                          {loyaltyStatus.current_points.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600">
                          {t('loyalty.points')}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {t('loyalty.forRewards')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress to next tier */}
                {loyaltyStatus.next_tier_name && loyaltyStatus.progress_percentage !== null && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                      <span>
                        {t('loyalty.progressToNextTier', { tier: loyaltyStatus.next_tier_name })}
                      </span>
                      <span>
                        {loyaltyStatus.nights_to_next_tier !== undefined && loyaltyStatus.nights_to_next_tier !== null
                          ? t('loyalty.nightsToGo', { count: loyaltyStatus.nights_to_next_tier })
                          : t('loyalty.maxTierReached')
                        }
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${loyaltyStatus.progress_percentage}%`,
                          backgroundColor: loyaltyStatus.tier_color
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loyalty Dashboard Section */}
          {loyaltyStatus && (
            <div className="mb-6">
              <div className="flex items-center space-x-2 mb-4">
                <FiGift className="h-6 w-6 text-primary-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t('loyalty.dashboard.title')}
                </h2>
              </div>

              {/* Swipeable Carousel */}
              <LoyaltyCarousel
                loyaltyStatus={loyaltyStatus}
                transactions={transactions}
              />
            </div>
          )}

          {/* User Menu Section */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {t('dashboard.myServices')}
            </h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* Profile & Loyalty Card */}
              <Link
                to="/profile"
                data-testid="nav-profile"
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

              {/* Book Room Card */}
              <Link
                to="/booking"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
                data-testid="nav-booking"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <FiCalendar className="h-6 w-6 text-primary-600" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          {t('booking.bookRoom')}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
                          {t('booking.bookRoomDescription')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>

              {/* My Bookings Card */}
              <Link
                to="/my-bookings"
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
                data-testid="nav-my-bookings"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="h-6 w-6 bg-blue-500 rounded flex items-center justify-center">
                        <span className="text-xs text-white font-bold">🏨</span>
                      </div>
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-lg font-semibold text-gray-900 truncate">
                          {t('booking.myBookings')}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-500">
                          {t('booking.viewMyBookings')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* Admin Menu Section (Admin+ Only) */}
          {isAdmin && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <FiUsers className="h-5 w-5 mr-2 text-blue-600" />
                {t('dashboard.adminMenu')}
              </h2>

              {/* Admin Cards */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {/* Loyalty Management Card */}
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

                {/* Coupon Management Card */}
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

                {/* Survey Management Card */}
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

                {/* User Management Card */}
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

                {/* New Member Coupons Card */}
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
                            {t('admin.newMemberCoupons.menuTitle')}
                          </dt>
                          <dd className="mt-1 text-sm font-medium text-gray-500">
                            {t('admin.newMemberCoupons.menuDescription')}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Transaction History Card */}
                <Link
                  to="/admin/transaction-history"
                  className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
                >
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="h-6 w-6 bg-indigo-500 rounded flex items-center justify-center">
                          <span className="text-xs text-white font-bold">📊</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-lg font-semibold text-gray-900 truncate">
                            {t('admin.loyalty.transactionHistory')}
                          </dt>
                          <dd className="mt-1 text-sm font-medium text-gray-500">
                            {t('admin.loyalty.viewTransactionHistory')}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Email Service Card */}
                <Link
                  to="/admin/email-service"
                  className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
                >
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <FiMail className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-lg font-semibold text-gray-900 truncate">
                            {t('dashboard.emailService')}
                          </dt>
                          <dd className="mt-1 text-sm font-medium text-gray-500">
                            {t('dashboard.emailServiceDesc')}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          )}

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
