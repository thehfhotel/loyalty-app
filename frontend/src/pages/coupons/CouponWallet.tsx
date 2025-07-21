import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UserActiveCoupon } from '../../types/coupon';
import { couponService } from '../../services/couponService';
import CouponCard from '../../components/coupons/CouponCard';
import QRCodeModal from '../../components/coupons/QRCodeModal';
import CouponDetailsModal from '../../components/coupons/CouponDetailsModal';
import DashboardButton from '../../components/navigation/DashboardButton';

const CouponWallet: React.FC = () => {
  const { t } = useTranslation();
  const [coupons, setCoupons] = useState<UserActiveCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoupon, setSelectedCoupon] = useState<UserActiveCoupon | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadCoupons = async (pageNum: number = 1, append: boolean = false) => {
    try {
      setLoading(true);
      setError(null);

      const response = await couponService.getUserCoupons(pageNum, 20);
      
      if (append) {
        setCoupons(prev => [...prev, ...response.coupons]);
      } else {
        setCoupons(response.coupons);
      }
      
      setTotalPages(response.totalPages);
      setHasMore(pageNum < response.totalPages);
      setPage(pageNum);
    } catch (err: any) {
      console.error('Error loading coupons:', err);
      setError(err.response?.data?.message || t('errors.failedToLoadCoupons'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCoupons();
  }, []);

  const handleUseCoupon = (coupon: UserActiveCoupon) => {
    setSelectedCoupon(coupon);
    setShowQRCode(true);
    setShowDetails(false);
  };

  const handleViewDetails = (coupon: UserActiveCoupon) => {
    setSelectedCoupon(coupon);
    setShowDetails(true);
    setShowQRCode(false);
  };

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      loadCoupons(page + 1, true);
    }
  };

  const handleRefresh = () => {
    setPage(1);
    loadCoupons(1, false);
  };

  // Separate coupons by expiry status
  const activeCoupons = coupons.filter(coupon => !couponService.isExpiringSoon(coupon));
  const expiringSoonCoupons = coupons.filter(coupon => couponService.isExpiringSoon(coupon));

  if (loading && coupons.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/4"></div>
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-gray-200 rounded"></div>
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
              <DashboardButton variant="outline" size="md" />
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? t('common.loading') : t('common.refresh')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto p-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="text-red-400 mr-3">⚠️</div>
              <div>
                <h3 className="text-red-800 font-medium">
                  {t('errors.error')}
                </h3>
                <p className="text-red-700 mt-1">{error}</p>
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

        {coupons.length === 0 && !loading && !error && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-6xl mb-4">🎫</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {t('coupons.noCoupons')}
            </h3>
            <p className="text-gray-600 mb-4">
              {t('coupons.noCouponsDescription')}
            </p>
            <button
              onClick={handleRefresh}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              {t('common.refresh')}
            </button>
          </div>
        )}

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

        {/* Load More Button */}
        {hasMore && (
          <div className="text-center mt-8">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="bg-gray-100 text-gray-700 px-6 py-3 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {loading ? t('common.loading') : t('common.loadMore')}
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