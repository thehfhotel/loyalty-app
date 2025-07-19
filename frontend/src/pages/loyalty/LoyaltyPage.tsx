import React, { useEffect, useState } from 'react';
import { Star, Gift, Trophy, Calendar, TrendingUp, Clock, Filter, ArrowUp, ArrowDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { 
  PointsTransaction, 
  RedemptionOption, 
  RedemptionRequest,
  CreateRedemptionRequestSchema,
  CreateRedemptionRequest
} from '@hotel-loyalty/shared/types/loyalty';
import { authService } from '../../services/authService';
import { toast } from 'react-hot-toast';

const LoyaltyPage: React.FC = () => {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [pointsHistory, setPointsHistory] = useState<PointsTransaction[]>([]);
  const [redemptionOptions, setRedemptionOptions] = useState<RedemptionOption[]>([]);
  const [myRedemptions, setMyRedemptions] = useState<RedemptionRequest[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [redeeming, setRedeeming] = useState<string | null>(null);

  useEffect(() => {
    loadLoyaltyData();
  }, []);

  const loadLoyaltyData = async () => {
    try {
      setLoading(true);
      
      // Load all loyalty data in parallel
      const [historyResponse, optionsResponse, redemptionsResponse] = await Promise.all([
        authService.makeAuthenticatedRequest<PointsTransaction[]>('/api/loyalty/points/history?limit=50'),
        authService.makeAuthenticatedRequest<RedemptionOption[]>('/api/loyalty/redemptions/options'),
        authService.makeAuthenticatedRequest<RedemptionRequest[]>('/api/loyalty/redemptions')
      ]);

      if (historyResponse.success) {
        setPointsHistory(historyResponse.data);
      }
      
      if (optionsResponse.success) {
        setRedemptionOptions(optionsResponse.data);
      }
      
      if (redemptionsResponse.success) {
        setMyRedemptions(redemptionsResponse.data);
      }
    } catch (error) {
      console.error('Failed to load loyalty data:', error);
      toast.error('Failed to load loyalty data');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async (optionId: string, pointsCost: number) => {
    try {
      setRedeeming(optionId);

      const redeemData: CreateRedemptionRequest = {
        redemptionOptionId: optionId
      };

      const validationResult = CreateRedemptionRequestSchema.safeParse(redeemData);
      if (!validationResult.success) {
        toast.error('Invalid redemption data');
        return;
      }

      const response = await authService.makeAuthenticatedRequest<RedemptionRequest>(
        '/api/loyalty/redemptions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(validationResult.data),
        }
      );

      if (response.success) {
        toast.success('Redemption request submitted successfully!');
        // Reload data to reflect new redemption and updated points balance
        loadLoyaltyData();
      } else {
        toast.error(response.message || 'Failed to submit redemption request');
      }
    } catch (error) {
      console.error('Redemption error:', error);
      toast.error('Failed to submit redemption request');
    } finally {
      setRedeeming(null);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'earned':
        return <ArrowUp className="w-4 h-4 text-green-500" />;
      case 'redeemed':
        return <ArrowDown className="w-4 h-4 text-red-500" />;
      case 'bonus':
        return <Star className="w-4 h-4 text-yellow-500" />;
      case 'expired':
        return <Clock className="w-4 h-4 text-gray-500" />;
      default:
        return <TrendingUp className="w-4 h-4 text-blue-500" />;
    }
  };

  const getRedemptionStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredHistory = pointsHistory.filter(transaction => {
    if (filterType === 'all') return true;
    return transaction.type === filterType;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-300 rounded w-64"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <div className="h-6 bg-gray-300 rounded w-32 mb-4"></div>
                  <div className="space-y-3">
                    {[...Array(4)].map((_, j) => (
                      <div key={j} className="h-4 bg-gray-300 rounded"></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Loyalty Rewards</h1>
            <p className="text-gray-600 mt-1">Manage your points and redeem rewards</p>
          </div>
          <div className="mt-4 sm:mt-0">
            <span className="inline-flex items-center px-4 py-2 rounded-full text-white text-sm font-medium bg-gradient-to-r from-purple-500 to-purple-600">
              <Trophy className="w-4 h-4 mr-2" />
              Loyalty Member
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('overview')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'overview'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Star className="w-4 h-4 inline mr-2" />
                Overview
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'history'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Calendar className="w-4 h-4 inline mr-2" />
                Points History
              </button>
              <button
                onClick={() => setActiveTab('rewards')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'rewards'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Gift className="w-4 h-4 inline mr-2" />
                Available Rewards
              </button>
              <button
                onClick={() => setActiveTab('redemptions')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'redemptions'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Clock className="w-4 h-4 inline mr-2" />
                My Redemptions
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Points Overview</h3>
                
                {/* Quick Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 rounded-xl text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-blue-100">Total Points Earned</p>
                        <p className="text-2xl font-bold">
                          {pointsHistory
                            .filter(t => t.type === 'earned' || t.type === 'bonus')
                            .reduce((sum, t) => sum + t.amount, 0)
                            .toLocaleString()}
                        </p>
                      </div>
                      <TrendingUp className="w-8 h-8 text-blue-200" />
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-green-500 to-green-600 p-6 rounded-xl text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-green-100">Points Redeemed</p>
                        <p className="text-2xl font-bold">
                          {Math.abs(pointsHistory
                            .filter(t => t.type === 'redeemed')
                            .reduce((sum, t) => sum + t.amount, 0))
                            .toLocaleString()}
                        </p>
                      </div>
                      <Gift className="w-8 h-8 text-green-200" />
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-6 rounded-xl text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-purple-100">Total Redemptions</p>
                        <p className="text-2xl font-bold">{myRedemptions.length}</p>
                      </div>
                      <Trophy className="w-8 h-8 text-purple-200" />
                    </div>
                  </div>
                </div>

                {/* Recent Activity Summary */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h4 className="text-md font-semibold text-gray-900 mb-4">Recent Activity</h4>
                  {pointsHistory.slice(0, 3).map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0">
                      <div className="flex items-center">
                        {getTransactionIcon(transaction.type)}
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">{transaction.description}</p>
                          <p className="text-xs text-gray-500">{formatDate(transaction.createdAt)}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-semibold ${
                        transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Points History</h3>
                  <div className="mt-4 sm:mt-0">
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="input w-auto"
                    >
                      <option value="all">All Transactions</option>
                      <option value="earned">Points Earned</option>
                      <option value="redeemed">Points Redeemed</option>
                      <option value="bonus">Bonus Points</option>
                      <option value="expired">Expired Points</option>
                      <option value="adjusted">Adjustments</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4">
                  {filteredHistory.length > 0 ? (
                    filteredHistory.map((transaction) => (
                      <div key={transaction.id} className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            {getTransactionIcon(transaction.type)}
                            <div className="ml-4">
                              <p className="text-sm font-medium text-gray-900">{transaction.description}</p>
                              <p className="text-xs text-gray-500">{formatDate(transaction.createdAt)}</p>
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                                transaction.type === 'earned' ? 'bg-green-100 text-green-800' :
                                transaction.type === 'redeemed' ? 'bg-red-100 text-red-800' :
                                transaction.type === 'bonus' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`text-lg font-semibold ${
                              transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                            </span>
                            <p className="text-xs text-gray-500">points</p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No transactions found for the selected filter</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'rewards' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Available Rewards</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {redemptionOptions.length > 0 ? (
                    redemptionOptions
                      .filter(option => option.isActive)
                      .map((option) => (
                        <div key={option.id} className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900">{option.title}</h4>
                              <p className="text-sm text-gray-600 mt-1">{option.description}</p>
                            </div>
                            <Gift className="w-6 h-6 text-purple-500 flex-shrink-0" />
                          </div>
                          
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-gray-600">Points Required:</span>
                              <span className="text-lg font-bold text-purple-600">{option.pointsCost.toLocaleString()}</span>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-gray-600">Category:</span>
                              <span className="text-sm font-medium text-gray-900">{option.category}</span>
                            </div>
                            
                            {option.expiryDate && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">Valid Until:</span>
                                <span className="text-sm text-gray-900">
                                  {new Date(option.expiryDate).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => handleRedeem(option.id, option.pointsCost)}
                            disabled={redeeming === option.id}
                            className="w-full mt-4 btn btn-primary"
                          >
                            {redeeming === option.id ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Redeeming...
                              </>
                            ) : (
                              <>
                                <Gift className="w-4 h-4 mr-2" />
                                Redeem Now
                              </>
                            )}
                          </button>
                        </div>
                      ))
                  ) : (
                    <div className="col-span-full text-center py-12">
                      <Gift className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No rewards available at the moment</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'redemptions' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">My Redemptions</h3>
                
                <div className="space-y-4">
                  {myRedemptions.length > 0 ? (
                    myRedemptions.map((redemption) => (
                      <div key={redemption.id} className="bg-white border border-gray-200 rounded-lg p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900">{redemption.redemptionOption.title}</h4>
                            <p className="text-sm text-gray-600">{redemption.redemptionOption.description}</p>
                          </div>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getRedemptionStatusColor(redemption.status)}`}>
                            {redemption.status.charAt(0).toUpperCase() + redemption.status.slice(1)}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Points Used:</span>
                            <p className="font-semibold text-purple-600">{redemption.pointsUsed.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-gray-600">Requested:</span>
                            <p className="font-medium text-gray-900">{formatDate(redemption.createdAt)}</p>
                          </div>
                          <div>
                            <span className="text-gray-600">Last Updated:</span>
                            <p className="font-medium text-gray-900">{formatDate(redemption.updatedAt)}</p>
                          </div>
                        </div>

                        {redemption.notes && (
                          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-700">{redemption.notes}</p>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No redemption requests yet</p>
                      <button
                        onClick={() => setActiveTab('rewards')}
                        className="mt-4 btn btn-primary"
                      >
                        <Gift className="w-4 h-4 mr-2" />
                        Browse Rewards
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoyaltyPage;