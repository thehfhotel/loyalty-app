import { useAuthStore } from '../store/authStore';
import { FiUser, FiLogOut, FiSettings, FiToggleLeft } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { getUserDisplayName } from '../utils/userHelpers';

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  
  // Check if user is super admin
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">Hotel Loyalty Dashboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">Welcome, {getUserDisplayName(user)}</span>
              <button
                onClick={logout}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <FiLogOut className="mr-2 h-4 w-4" />
                Logout
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
                        My Profile
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        Manage your personal information
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>

            {/* Loyalty Points Card (Placeholder for Phase 2) */}
            <div className="bg-white overflow-hidden shadow rounded-lg opacity-50 cursor-not-allowed">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 bg-gold-500 rounded-full"></div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">
                        Loyalty Points
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        Coming in Phase 2
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            {/* Coupons Card (Placeholder for Phase 3) */}
            <div className="bg-white overflow-hidden shadow rounded-lg opacity-50 cursor-not-allowed">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 bg-green-500 rounded"></div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">
                        My Coupons
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        Coming in Phase 3
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

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
                          Feature Toggles
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-gray-900">
                          Manage system features
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
                Welcome to the Hotel Loyalty Program!
              </h3>
              <div className="mt-2 max-w-xl text-sm text-gray-500">
                <p>
                  This is Phase 1 of our loyalty system. You can manage your profile and account
                  settings. More features including loyalty points, coupons, and surveys will be
                  available in upcoming phases.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}