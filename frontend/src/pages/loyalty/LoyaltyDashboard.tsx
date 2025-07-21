import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiGift, FiDollarSign } from 'react-icons/fi';
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
  const [isSimulating, setIsSimulating] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [simulatorData, setSimulatorData] = useState({
    amountSpent: '',
    stayId: ''
  });

  useEffect(() => {
    loadLoyaltyData();
  }, []);

  const loadLoyaltyData = async () => {
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
  };

  const handleSimulateStay = async () => {
    if (!simulatorData.amountSpent || parseFloat(simulatorData.amountSpent) <= 0) {
      toast.error(t('loyalty.amountSpent') + ' is required');
      return;
    }

    try {
      setIsSimulating(true);
      const result = await loyaltyService.simulateStayEarning(
        parseFloat(simulatorData.amountSpent),
        simulatorData.stayId || undefined
      );

      // Update local state with new data
      setLoyaltyStatus(result.loyaltyStatus);
      
      // Reload transaction history to show the new transaction
      const historyResult = await loyaltyService.getPointsHistory(20, 0);
      setTransactions(historyResult.transactions);

      // Update points calculation
      const calculationResult = await loyaltyService.getPointsCalculation();
      setPointsCalculation(calculationResult);

      toast.success(t('loyalty.pointsEarned'));
      setShowSimulator(false);
      setSimulatorData({ amountSpent: '', stayId: '' });
    } catch (error) {
      console.error('Error simulating stay:', error);
      toast.error('Failed to simulate stay earning');
    } finally {
      setIsSimulating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="h-48 bg-gray-200 rounded-lg"></div>
                <div className="h-64 bg-gray-200 rounded-lg"></div>
              </div>
              <div className="h-96 bg-gray-200 rounded-lg"></div>
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

        {/* Demo Simulator Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowSimulator(!showSimulator)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <FiDollarSign className="w-4 h-4" />
            <span>{t('loyalty.simulateStay')}</span>
          </button>
        </div>

        {/* Simulator Panel */}
        {showSimulator && (
          <div className="mb-6 bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('loyalty.simulateStay')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="amountSpent" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('loyalty.amountSpent')} (THB)
                </label>
                <input
                  type="number"
                  id="amountSpent"
                  value={simulatorData.amountSpent}
                  onChange={(e) => setSimulatorData(prev => ({ ...prev, amountSpent: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="5000"
                  min="1"
                />
              </div>
              <div>
                <label htmlFor="stayId" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('loyalty.stayId')}
                </label>
                <input
                  type="text"
                  id="stayId"
                  value={simulatorData.stayId}
                  onChange={(e) => setSimulatorData(prev => ({ ...prev, stayId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="STAY-001"
                />
              </div>
            </div>
            <div className="mt-4 flex space-x-3">
              <button
                onClick={handleSimulateStay}
                disabled={isSimulating}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSimulating ? t('common.loading') : t('loyalty.earnPoints')}
              </button>
              <button
                onClick={() => setShowSimulator(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

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