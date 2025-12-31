import { useState, useEffect, useCallback } from 'react';
import { FiGift, FiCheck, FiX, FiInfo, FiAlertTriangle, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import MainLayout from '../../components/layout/MainLayout';
import { adminService, CouponStatusForAdmin } from '../../services/adminService';
import { couponService } from '../../services/couponService';
import type { Coupon } from '../../types/coupon';
import { logger } from '../../utils/logger';

interface NewMemberCouponSettings {
  id: string;
  isEnabled: boolean;
  selectedCouponId: string | null;
  pointsEnabled: boolean;
  pointsAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function NewMemberCouponSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NewMemberCouponSettings | null>(null);
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>([]);
  const [couponStatus, setCouponStatus] = useState<CouponStatusForAdmin | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanged, setHasChanged] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [selectedCouponId, setSelectedCouponId] = useState<string>('');
  const [pointsEnabled, setPointsEnabled] = useState(false);
  const [pointsAmount, setPointsAmount] = useState<string>('');

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);

      // Load current settings and available coupons in parallel
      const [settingsData, couponsData] = await Promise.all([
        adminService.getNewMemberCouponSettings(),
        couponService.getCoupons(1, 100, { status: 'active' }) // Get all active coupons
      ]);

      setSettings(settingsData);
      setAvailableCoupons(couponsData.coupons);

      // Set form state from loaded settings
      setIsEnabled(settingsData.isEnabled);
      setSelectedCouponId(settingsData.selectedCouponId ?? '');
      setPointsEnabled(settingsData.pointsEnabled);
      setPointsAmount(settingsData.pointsAmount?.toString() ?? '');

    } catch (error: unknown) {
      logger.error('Failed to load data:', error);
      const errorMessage = error instanceof Error && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      toast.error(errorMessage ?? t('admin.newMemberCoupons.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (settings) {
      const currentState = {
        isEnabled,
        selectedCouponId,
        pointsEnabled,
        pointsAmount
      };
      const originalState = {
        isEnabled: settings.isEnabled,
        selectedCouponId: settings.selectedCouponId ?? '',
        pointsEnabled: settings.pointsEnabled,
        pointsAmount: settings.pointsAmount?.toString() ?? ''
      };
      setHasChanged(JSON.stringify(currentState) !== JSON.stringify(originalState));
    }
  }, [isEnabled, selectedCouponId, pointsEnabled, pointsAmount, settings]);

  // Load coupon status when a coupon is selected
  useEffect(() => {
    const loadCouponStatus = async () => {
      if (selectedCouponId && availableCoupons.length > 0) {
        try {
          const status = await adminService.getCouponStatusForAdmin(selectedCouponId);
          setCouponStatus(status);
        } catch (error) {
          logger.error('Failed to load coupon status:', error);
          setCouponStatus(null);
        }
      } else {
        setCouponStatus(null);
      }
    };

    loadCouponStatus();
  }, [selectedCouponId, availableCoupons]);

  const handleSave = async () => {
    if (!hasChanged) {return;}
    
    setIsSaving(true);
    try {
      const updateData = {
        isEnabled,
        selectedCouponId: selectedCouponId ?? null,
        pointsEnabled,
        pointsAmount: pointsAmount ? parseInt(pointsAmount) : null
      };
      
      const updatedSettings = await adminService.updateNewMemberCouponSettings(updateData);
      setSettings(updatedSettings);
      setHasChanged(false);
      toast.success(t('admin.newMemberCoupons.updateSuccess'));
    } catch (error: unknown) {
      logger.error('Failed to update settings:', error);
      const errorMessage = error instanceof Error && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      toast.error(errorMessage ?? t('admin.newMemberCoupons.updateError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setIsEnabled(settings.isEnabled);
      setSelectedCouponId(settings.selectedCouponId ?? '');
      setPointsEnabled(settings.pointsEnabled);
      setPointsAmount(settings.pointsAmount?.toString() ?? '');
      setHasChanged(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout title={t('admin.newMemberCoupons.title')} showProfileBanner={false}>
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
            <p className="mt-4 text-gray-600">{t('admin.newMemberCoupons.loading')}</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title={t('admin.newMemberCoupons.title')} showProfileBanner={false} showDashboardButton={true}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <FiGift className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-gray-600">{t('admin.newMemberCoupons.description')}</p>
            </div>
          </div>
          
          {/* Info Banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <FiInfo className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">{t('admin.newMemberCoupons.howItWorks')}</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>{t('admin.newMemberCoupons.howItWorksItems.banner')}</li>
                  <li>{t('admin.newMemberCoupons.howItWorksItems.rewards')}</li>
                  <li>{t('admin.newMemberCoupons.howItWorksItems.options')}</li>
                  <li>{t('admin.newMemberCoupons.howItWorksItems.once')}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Simplified Settings Form */}
        <div className="bg-white shadow rounded-lg">
          <div className="p-6 space-y-6">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-medium text-gray-900">{t('admin.newMemberCoupons.enableCoupons')}</h3>
                <p className="text-sm text-gray-500">{t('admin.newMemberCoupons.enableCouponsDescription')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
              </label>
            </div>

            {/* Coupon Selection */}
            <div>
              <label htmlFor="couponSelect" className="block text-sm font-medium text-gray-700 mb-2">
                {t('admin.newMemberCoupons.selectCoupon')} *
              </label>
              <select
                id="couponSelect"
                value={selectedCouponId}
                onChange={(e) => setSelectedCouponId(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                disabled={!isEnabled}
              >
                <option value="">{t('admin.newMemberCoupons.selectCouponPlaceholder')}</option>
                {availableCoupons.map((coupon) => (
                  <option key={coupon.id} value={coupon.id}>
                    {coupon.code} - {coupon.name} ({coupon.type === 'percentage' ? `${coupon.value}%` : `$${coupon.value}`} {t('admin.newMemberCoupons.off')})
                    {coupon.validUntil && ` - ${t('coupons.expiresOn')} ${new Date(coupon.validUntil).toLocaleDateString()}`}
                  </option>
                ))}
              </select>
              {isEnabled && !selectedCouponId && (
                <p className="mt-1 text-sm text-red-600">{t('admin.newMemberCoupons.selectCouponRequired')}</p>
              )}
              {availableCoupons.length === 0 && !isLoading && (
                <p className="mt-1 text-sm text-gray-500">{t('admin.newMemberCoupons.noCouponsAvailable')}</p>
              )}

              {/* Coupon Status Warnings */}
              {couponStatus && couponStatus.warningLevel !== 'none' && (
                <div className={`mt-2 p-3 rounded-md border ${
                  couponStatus.warningLevel === 'danger' 
                    ? 'bg-red-50 border-red-200' 
                    : 'bg-yellow-50 border-yellow-200'
                }`}
                >
                  <div className="flex items-start space-x-2">
                    {couponStatus.warningLevel === 'danger' ? (
                      <FiAlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    ) : (
                      <FiAlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${
                        couponStatus.warningLevel === 'danger' ? 'text-red-800' : 'text-yellow-800'
                      }`}
                      >
                        {couponStatus.isExpired ? t('admin.newMemberCoupons.couponExpired') : t('admin.newMemberCoupons.couponExpiringSoon')}
                      </p>
                      <p className={`text-sm mt-1 ${
                        couponStatus.warningLevel === 'danger' ? 'text-red-700' : 'text-yellow-700'
                      }`}
                      >
                        {couponStatus.isExpired
                          ? t('admin.newMemberCoupons.expiredMessage', { date: couponStatus.validUntil ? new Date(couponStatus.validUntil).toLocaleDateString() : '' })
                          : t('admin.newMemberCoupons.expiringSoonMessage', { days: couponStatus.daysUntilExpiry, date: couponStatus.validUntil ? new Date(couponStatus.validUntil).toLocaleDateString() : '' })
                        }
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Selected Coupon Details */}
            {selectedCouponId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">{t('admin.newMemberCoupons.selectedCouponDetails')}</h4>
                {(() => {
                  const selectedCoupon = availableCoupons.find(c => c.id === selectedCouponId);
                  if (!selectedCoupon) {return null;}
                  return (
                    <div className="space-y-1 text-sm text-gray-600">
                      <p><span className="font-medium">{t('admin.newMemberCoupons.code')}:</span> {selectedCoupon.code}</p>
                      <p><span className="font-medium">{t('admin.newMemberCoupons.name')}:</span> {selectedCoupon.name}</p>
                      <p><span className="font-medium">{t('admin.newMemberCoupons.type')}:</span> {selectedCoupon.type === 'percentage' ? t('admin.newMemberCoupons.typePercentage') : t('admin.newMemberCoupons.typeFixed')}</p>
                      <p><span className="font-medium">{t('admin.newMemberCoupons.value')}:</span> {selectedCoupon.type === 'percentage' ? `${selectedCoupon.value}%` : `$${selectedCoupon.value}`}</p>
                      {selectedCoupon.description && (
                        <p><span className="font-medium">{t('admin.newMemberCoupons.description_field')}:</span> {selectedCoupon.description}</p>
                      )}
                      <p><span className="font-medium">{t('admin.newMemberCoupons.status')}:</span> <span className="capitalize">{selectedCoupon.status}</span></p>
                      
                      {/* Enhanced Expiry Information */}
                      {couponStatus && (
                        <>
                          {couponStatus.validFrom && (
                            <p><span className="font-medium">{t('admin.newMemberCoupons.validFrom')}:</span> {new Date(couponStatus.validFrom).toLocaleDateString()}</p>
                          )}
                          {couponStatus.validUntil && (
                            <p>
                              <span className="font-medium">{t('admin.newMemberCoupons.validUntil')}:</span>{' '}
                              <span className={
                                couponStatus.warningLevel === 'danger' ? 'text-red-600 font-medium' :
                                couponStatus.warningLevel === 'warning' ? 'text-yellow-600 font-medium' :
                                'text-gray-600'
                              }
                              >
                                {new Date(couponStatus.validUntil).toLocaleDateString()}
                                {couponStatus.isExpired && ` (${t('admin.newMemberCoupons.expired')})`}
                                {!couponStatus.isExpired && couponStatus.daysUntilExpiry !== null && couponStatus.daysUntilExpiry <= 7 &&
                                  ` (${t('admin.newMemberCoupons.daysRemaining', { count: couponStatus.daysUntilExpiry })})`
                                }
                              </span>
                            </p>
                          )}
                          {!couponStatus.validUntil && (
                            <p><span className="font-medium">{t('admin.newMemberCoupons.validUntil')}:</span> <span className="text-green-600">{t('admin.newMemberCoupons.noExpiry')}</span></p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Points Configuration */}
            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center justify-between py-4 border-b border-gray-200">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{t('admin.newMemberCoupons.enablePoints')}</h3>
                  <p className="text-sm text-gray-500">{t('admin.newMemberCoupons.enablePointsDescription')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pointsEnabled}
                    onChange={(e) => setPointsEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                </label>
              </div>

              {/* Points Amount Input */}
              <div className="mt-4">
                <label htmlFor="pointsAmount" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.newMemberCoupons.pointsToAward')} *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    id="pointsAmount"
                    value={pointsAmount}
                    onChange={(e) => setPointsAmount(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    placeholder={t('admin.newMemberCoupons.pointsPlaceholder')}
                    min="1"
                    max="10000"
                    disabled={!pointsEnabled}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 text-sm">{t('admin.newMemberCoupons.points')}</span>
                  </div>
                </div>
                {pointsEnabled && !pointsAmount && (
                  <p className="mt-1 text-sm text-red-600">{t('admin.newMemberCoupons.pointsRequired')}</p>
                )}
                {pointsEnabled && pointsAmount && (parseInt(pointsAmount) < 1 || parseInt(pointsAmount) > 10000) && (
                  <p className="mt-1 text-sm text-red-600">{t('admin.newMemberCoupons.pointsRange')}</p>
                )}
                {pointsEnabled && pointsAmount && parseInt(pointsAmount) >= 1 && parseInt(pointsAmount) <= 10000 && (
                  <p className="mt-1 text-sm text-green-600">
                    {t('admin.newMemberCoupons.pointsSuccess', { count: parseInt(pointsAmount) })}
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={handleReset}
                disabled={!hasChanged || isSaving}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiX className="mr-2 h-4 w-4" />
                {t('admin.newMemberCoupons.reset')}
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={
                  !hasChanged ||
                  isSaving ||
                  (isEnabled && !selectedCouponId) ||
                  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                  (isEnabled && couponStatus?.isExpired) ||
                  (pointsEnabled && (!pointsAmount || (parseInt(pointsAmount) < 1 || parseInt(pointsAmount) > 10000)))
                }
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    {t('admin.newMemberCoupons.saving')}
                  </>
                ) : (
                  <>
                    <FiCheck className="mr-2 h-4 w-4" />
                    {t('admin.newMemberCoupons.saveSettings')}
                  </>
                )}
              </button>
            </div>

            {/* Save Button Help Text */}
            {isEnabled && couponStatus?.isExpired && (
              <p className="mt-2 text-sm text-red-600">
                {t('admin.newMemberCoupons.expiredCouponError')}
              </p>
            )}
            {pointsEnabled && (!pointsAmount || parseInt(pointsAmount) < 1 || parseInt(pointsAmount) > 10000) && (
              <p className="mt-2 text-sm text-red-600">
                {t('admin.newMemberCoupons.invalidPointsError')}
              </p>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}