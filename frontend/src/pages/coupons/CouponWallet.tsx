import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserActiveCoupon } from '../../types/coupon';
import { couponService } from '../../services/couponService';
import CouponCard from '../../components/coupons/CouponCard';
import QRCodeModal from '../../components/coupons/QRCodeModal';
import CouponDetailsModal from '../../components/coupons/CouponDetailsModal';
import DashboardButton from '../../components/navigation/DashboardButton';
import { trpc } from '../../hooks/useTRPC';
import { getTRPCErrorMessage } from '../../hooks/useTRPC';

type CouponFilter = 'active' | 'used' | 'expired';

const CouponWallet: React.FC = () => {
  const { t } = useTranslation();
  const [selectedCoupon, setSelectedCoupon] = useState<UserActiveCoupon | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<CouponFilter>('active');

  // Map filter to tRPC status
  const getStatusFromFilter = (filter: CouponFilter): 'available' | 'used' | 'expired' | undefined => {
    switch (filter) {
      case 'used':
        return 'used';
      case 'expired':
        return 'expired';
      case 'active':
      default:
        return undefined; // Use default (active coupons)
    }
  };

  // Fetch coupons using tRPC
  const { data: couponResponse, isLoading, error, refetch } = trpc.coupon.getMyCoupons.useQuery({
    page,
    limit: 20,
    status: getStatusFromFilter(activeFilter),
  });

  const coupons = couponResponse?.coupons ?? [];
  const totalPages = couponResponse?.totalPages ?? 1;
  const hasMore = page < totalPages;

  const handleFilterChange = (filter: CouponFilter) => {
    if (filter !== activeFilter) {
      setActiveFilter(filter);
      setPage(1);
    }
  };

  const handleUseCoupon = (coupon: UserActiveCoupon) => {
    // Only allow using active coupons
    if (activeFilter === 'active') {
      setSelectedCoupon(coupon);
      setShowQRCode(true);
      setShowDetails(false);
    }
  };

  const handleViewDetails = (coupon: UserActiveCoupon) => {
    setSelectedCoupon(coupon);
    setShowDetails(true);
    setShowQRCode(false);
  };

  const handleLoadMore = () => {
    if (hasMore && !isLoading) {
      setPage(page + 1);
    }
  };

  const handleRefresh = () => {
    setPage(1);
    refetch();
  };

  // Separate coupons by expiry status (only for active filter)
  const activeCoupons = activeFilter === 'active' 
    ? coupons.filter(coupon => !couponService.isExpiringSoon(coupon))
    : [];
  const expiringSoonCoupons = activeFilter === 'active'
    ? coupons.filter(coupon => couponService.isExpiringSoon(coupon))
    : [];

  const errorMessage = error ? getTRPCErrorMessage(error) : null;

  if (isLoading && coupons.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/4" />
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-gray-200 rounded" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {t('coupons.myCoupons')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('coupons.walletDescription')}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="inline-flex items-center font-medium border border-gray-300 bg-white text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {isLoading ? t('common.loading') : t('common.refresh')}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="max-w-4xl mx-auto p-4">
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {/* Active Tab */}
              <button
                onClick={() => handleFilterChange('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeFilter === 'active'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t('coupons.activeCoupons')}
              </button>
              
              {/* Used Tab */}
              <button
                onClick={() => handleFilterChange('used')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeFilter === 'used'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t('coupons.usedCoupons', 'Used')}
              </button>
              
              {/* Expired Tab */}
              <button
                onClick={() => handleFilterChange('expired')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeFilter === 'expired'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t('coupons.expiredCoupons', 'Expired')}
              </button>
            </nav>
          </div>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="text-red-400 mr-3">⚠️</div>
              <div>
                <h3 className="text-red-800 font-medium">
                  {t('errors.error')}
                </h3>
                <p className="text-red-700 mt-1">{errorMessage}</p>
                <button
                  onClick={handleRefresh}
                  className="text-red-600 underline hover:text-red-800 mt-2"
                >
                  {t('common.tryAgain')}
                </button>
              </div>
            </div>
          </div>
        )}

        {coupons.length === 0 && !isLoading && !errorMessage && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-6xl mb-4">
              {activeFilter === 'used' ? '✓' : activeFilter === 'expired' ? '⏰' : '🎫'}
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {activeFilter === 'used' 
                ? t('coupons.noUsedCoupons', 'No Used Coupons')
                : activeFilter === 'expired' 
                  ? t('coupons.noExpiredCoupons', 'No Expired Coupons')
                  : t('coupons.noCoupons')
              }
            </h3>
            <p className="text-gray-600 mb-4">
              {activeFilter === 'used' 
                ? t('coupons.noUsedCouponsDescription', "You haven't used any coupons yet.")
                : activeFilter === 'expired' 
                  ? t('coupons.noExpiredCouponsDescription', "You don't have any expired coupons.")
                  : t('coupons.noCouponsDescription')
              }
            </p>
            <button
              onClick={handleRefresh}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              {t('common.refresh')}
            </button>
          </div>
        )}

        {/* Coupon Display Based on Active Filter */}
        {activeFilter === 'active' && (
          <>
            {/* Expiring Soon Section */}
            {expiringSoonCoupons.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center mb-4">
                  <div className="bg-red-100 p-2 rounded-full mr-3">
                    <span className="text-red-600 text-xl">⏰</span>
                  </div>
                  <h2 className="text-xl font-semibold text-red-700">
                    {t('coupons.expiringSoon')} ({expiringSoonCoupons.length})
                  </h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {expiringSoonCoupons.map((coupon) => (
                    <CouponCard
                      key={coupon.userCouponId}
                      coupon={coupon}
                      onUse={handleUseCoupon}
                      onViewDetails={handleViewDetails}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Active Coupons Section */}
            {activeCoupons.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center mb-4">
                  <div className="bg-green-100 p-2 rounded-full mr-3">
                    <span className="text-green-600 text-xl">✅</span>
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {t('coupons.activeCoupons')} ({activeCoupons.length})
                  </h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {activeCoupons.map((coupon) => (
                    <CouponCard
                      key={coupon.userCouponId}
                      coupon={coupon}
                      onUse={handleUseCoupon}
                      onViewDetails={handleViewDetails}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Used/Expired Coupons Display */}
        {(activeFilter === 'used' || activeFilter === 'expired') && coupons.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center mb-4">
              <div className={`p-2 rounded-full mr-3 ${
                activeFilter === 'used' 
                  ? 'bg-gray-100' 
                  : 'bg-red-100'
              }`}
              >
                <span className={`text-xl ${
                  activeFilter === 'used' 
                    ? 'text-gray-600' 
                    : 'text-red-600'
                }`}
                >
                  {activeFilter === 'used' ? '✓' : '⏰'}
                </span>
              </div>
              <h2 className={`text-xl font-semibold ${
                activeFilter === 'used' 
                  ? 'text-gray-900' 
                  : 'text-red-700'
              }`}
              >
                {activeFilter === 'used' 
                  ? t('coupons.usedCoupons', 'Used Coupons')
                  : t('coupons.expiredCoupons', 'Expired Coupons')
                } ({coupons.length})
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {coupons.map((coupon) => (
                <CouponCard
                  key={coupon.userCouponId}
                  coupon={coupon}
                  onUse={handleUseCoupon}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          </div>
        )}

        {/* Load More Button */}
        {hasMore && (
          <div className="text-center mt-8">
            <button
              onClick={handleLoadMore}
              disabled={isLoading}
              className="bg-gray-100 text-gray-700 px-6 py-3 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {isLoading ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQRCode && selectedCoupon && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="max-w-md w-full max-h-full overflow-y-auto">
            <QRCodeModal
              coupon={selectedCoupon}
              onClose={() => {
                setShowQRCode(false);
                setSelectedCoupon(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Coupon Details Modal */}
      {showDetails && selectedCoupon && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="max-w-lg w-full max-h-full overflow-y-auto">
            <CouponDetailsModal
              coupon={selectedCoupon}
              onClose={() => {
                setShowDetails(false);
                setSelectedCoupon(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CouponWallet;