import React, { useEffect, useState } from 'react';
import { User, Trophy, Gift, TrendingUp, Calendar, Star } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { LoyaltyDashboard } from '@hotel-loyalty/shared/types/loyalty';
import { CustomerStats } from '@hotel-loyalty/shared/types/customer';
import { authService } from '../../services/authService';

const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const [loyaltyData, setLoyaltyData] = useState<LoyaltyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const response = await authService.makeAuthenticatedRequest<LoyaltyDashboard>(
        '/api/loyalty/dashboard'
      );
      
      if (response.success) {
        setLoyaltyData(response.data);
      } else {
        setError(response.message || 'Failed to load dashboard data');
      }
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getTierColor = (tierName: string) => {
    switch (tierName.toLowerCase()) {
      case 'bronze': return 'from-amber-600 to-amber-700';
      case 'silver': return 'from-gray-400 to-gray-500';
      case 'gold': return 'from-yellow-400 to-yellow-500';
      case 'platinum': return 'from-purple-500 to-purple-600';
      default: return 'from-blue-500 to-blue-600';
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded w-64 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <div className="h-6 bg-gray-300 rounded w-20 mb-2"></div>
                  <div className="h-8 bg-gray-300 rounded w-32"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={loadDashboardData}
              className="btn btn-primary"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back, {user?.firstName}! 👋
            </h1>
            <p className="text-gray-600 mt-1">
              Here's your loyalty overview
            </p>
          </div>
          <div className="mt-4 sm:mt-0">
            <span className={`inline-flex items-center px-4 py-2 rounded-full text-white text-sm font-medium bg-gradient-to-r ${getTierColor(loyaltyData?.currentTier || '')}`}>
              <Trophy className="w-4 h-4 mr-2" />
              {loyaltyData?.currentTier} Member
            </span>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Star className="h-8 w-8 text-yellow-500" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Points Balance
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {loyaltyData?.pointsBalance?.toLocaleString()}
                  </dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-8 w-8 text-green-500" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Lifetime Points
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {loyaltyData?.lifetimePoints?.toLocaleString()}
                  </dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Gift className="h-8 w-8 text-purple-500" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Available Rewards
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {loyaltyData?.availableRedemptions?.length || 0}
                  </dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Calendar className="h-8 w-8 text-blue-500" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Pending Redemptions
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {loyaltyData?.pendingRedemptions?.length || 0}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* Tier Progress */}
        {loyaltyData?.nextTier && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Progress to {loyaltyData.nextTier}
              </h3>
              <span className="text-sm text-gray-500">
                {loyaltyData.pointsToNextTier} points to go
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${loyaltyData.tierProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {loyaltyData.tierProgress.toFixed(1)}% complete
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Activity */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Recent Activity
            </h3>
            {loyaltyData?.recentTransactions && loyaltyData.recentTransactions.length > 0 ? (
              <div className="space-y-4">
                {loyaltyData.recentTransactions.slice(0, 5).map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
                    <div className="flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-3 ${
                        transaction.type === 'earned' ? 'bg-green-500' : 
                        transaction.type === 'redeemed' ? 'bg-red-500' : 'bg-blue-500'
                      }`}></div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {transaction.description}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDate(transaction.createdAt)}
                        </p>
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
            ) : (
              <p className="text-gray-500 text-center py-8">
                No recent activity
              </p>
            )}
          </div>

          {/* Tier Benefits */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Your {loyaltyData?.currentTier} Benefits
            </h3>
            {loyaltyData?.tierBenefits && loyaltyData.tierBenefits.length > 0 ? (
              <ul className="space-y-3">
                {loyaltyData.tierBenefits.map((benefit, index) => (
                  <li key={index} className="flex items-start">
                    <Star className="w-4 h-4 text-yellow-500 mt-0.5 mr-3 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{benefit}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 text-center py-8">
                No benefits information available
              </p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Quick Actions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button 
              className="btn btn-primary"
              onClick={() => window.location.href = '/loyalty'}
            >
              <Gift className="w-4 h-4 mr-2" />
              View Rewards
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => window.location.href = '/coupons'}
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              My Coupons
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => window.location.href = '/profile'}
            >
              <User className="w-4 h-4 mr-2" />
              Edit Profile
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => window.location.href = '/surveys'}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Take Survey
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;