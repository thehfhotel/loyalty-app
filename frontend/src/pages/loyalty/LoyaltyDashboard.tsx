import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FiGift } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { 
  loyaltyService, 
  UserLoyaltyStatus, 
  Tier, 
  PointsTransaction,
  PointsCalculation
} from '../../services/loyaltyService';
import PointsBalance from '../../components/loyalty/PointsBalance';
import TierStatus from '../../components/loyalty/TierStatus';
import TransactionList from '../../components/loyalty/TransactionList';
import { useAuthStore } from '../../store/authStore';
import DashboardButton from '../../components/navigation/DashboardButton';

export default function LoyaltyDashboard() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  
  const [loyaltyStatus, setLoyaltyStatus] = useState<UserLoyaltyStatus | null>(null);
  const [allTiers, setAllTiers] = useState<Tier[]>([]);
  const [pointsCalculation, setPointsCalculation] = useState<PointsCalculation | null>(null);
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadLoyaltyData = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Load all data in parallel
      const [statusResult, tiersResult, calculationResult, historyResult] = await Promise.all([
        loyaltyService.getUserLoyaltyStatus(),
        loyaltyService.getTiers(),
        loyaltyService.getPointsCalculation(),
        loyaltyService.getPointsHistory(20, 0)
      ]);

      setLoyaltyStatus(statusResult);
      setAllTiers(tiersResult);
      setPointsCalculation(calculationResult);
      setTransactions(historyResult.transactions);
    } catch (error) {
      console.error('Error loading loyalty data:', error);
      toast.error(t('errors.networkError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadLoyaltyData();
  }, [loadLoyaltyData]);


  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/3" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="h-48 bg-gray-200 rounded-lg" />
                <div className="h-64 bg-gray-200 rounded-lg" />
              </div>
              <div className="h-96 bg-gray-200 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!loyaltyStatus || !pointsCalculation) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">{t('errors.networkError')}</p>
          <button
            onClick={loadLoyaltyData}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            {t('common.refresh')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {t('loyalty.dashboard.title')}
              </h1>
              <p className="mt-2 text-gray-600">
                {t('loyalty.dashboard.welcome')}
              </p>
            </div>
            <DashboardButton variant="outline" size="md" />
          </div>
        </div>


        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Points & Tier */}
          <div className="lg:col-span-2 space-y-6">
            {/* Points Balance */}
            <PointsBalance
              loyaltyStatus={loyaltyStatus}
              expiringPoints={pointsCalculation.expiring_points}
              nextExpiryDate={pointsCalculation.next_expiry_date}
            />

            {/* Transaction History */}
            <TransactionList
              transactions={transactions}
              isLoading={false}
            />
          </div>

          {/* Right Column - Tier Status */}
          <div className="space-y-6">
            <TierStatus
              loyaltyStatus={loyaltyStatus}
              allTiers={allTiers}
            />
          </div>
        </div>
      </div>
    </div>
  );
}