import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { loyaltyService } from '../services/loyaltyService';
import './Dashboard.css';

const Dashboard = () => {
  const { user } = useAuth();
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchLoyaltyData();
  }, []);

  const fetchLoyaltyData = async () => {
    try {
      setLoading(true);
      
      // For now, we'll use the user data and create a mock dashboard
      // since the loyalty service endpoints might not be fully connected
      const mockLoyaltyData = {
        user: {
          id: user.id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          tier: user.loyaltyTier || 'bronze',
          totalPoints: user.totalPoints || 0
        },
        tierInfo: {
          currentTier: {
            name: user.loyaltyTier || 'bronze',
            minPoints: getTierMinPoints(user.loyaltyTier || 'bronze'),
            benefits: getTierBenefits(user.loyaltyTier || 'bronze'),
            pointMultiplier: getTierMultiplier(user.loyaltyTier || 'bronze')
          },
          nextTier: getNextTier(user.loyaltyTier || 'bronze'),
          userStats: {
            totalPoints: user.totalPoints || 0,
            totalNights: 0,
            totalSpent: 0,
            thisYearNights: 0,
            thisYearSpend: 0
          }
        },
        pointsSummary: {
          totalEarned: user.totalPoints || 0,
          totalRedeemed: 0,
          totalExpired: 0,
          pointsExpiringSoon: 0,
          totalTransactions: 0
        },
        recentTransactions: [],
        availableRewards: [],
        recentRedemptions: []
      };

      setLoyaltyData(mockLoyaltyData);
    } catch (error) {
      console.error('Error fetching loyalty data:', error);
      setError('Failed to load loyalty data');
    } finally {
      setLoading(false);
    }
  };

  const getTierMinPoints = (tier) => {
    const tiers = {
      bronze: 0,
      silver: 1000,
      gold: 5000,
      platinum: 10000
    };
    return tiers[tier] || 0;
  };

  const getTierMultiplier = (tier) => {
    const multipliers = {
      bronze: 1.0,
      silver: 1.25,
      gold: 1.5,
      platinum: 2.0
    };
    return multipliers[tier] || 1.0;
  };

  const getTierBenefits = (tier) => {
    const benefits = {
      bronze: ['Earn 1x points', 'Standard check-in'],
      silver: ['Earn 1.25x points', 'Priority check-in', 'Late checkout'],
      gold: ['Earn 1.5x points', 'Room upgrades', 'Free breakfast', 'Lounge access'],
      platinum: ['Earn 2x points', 'Suite upgrades', 'Free breakfast', 'Lounge access', 'Concierge service']
    };
    return benefits[tier] || [];
  };

  const getNextTier = (currentTier) => {
    const tiers = ['bronze', 'silver', 'gold', 'platinum'];
    const currentIndex = tiers.indexOf(currentTier);
    
    if (currentIndex < tiers.length - 1) {
      const nextTier = tiers[currentIndex + 1];
      return {
        name: nextTier,
        minPoints: getTierMinPoints(nextTier),
        progressPercentage: (user.totalPoints / getTierMinPoints(nextTier)) * 100
      };
    }
    return null;
  };

  const getTierColor = (tier) => {
    const colors = {
      bronze: '#cd7f32',
      silver: '#c0c0c0',
      gold: '#ffd700',
      platinum: '#e5e4e2'
    };
    return colors[tier] || '#cd7f32';
  };

  if (loading) {
    return <div className="loading">Loading your loyalty dashboard...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="dashboard-container">
      <div className="container">
        <div className="dashboard-header">
          <h1>Welcome back, {user.firstName}!</h1>
          <p>Here's your loyalty status and recent activity</p>
        </div>

        <div className="dashboard-grid">
          <div className="loyalty-card">
            <div className="tier-badge" style={{ backgroundColor: getTierColor(loyaltyData.tierInfo.currentTier.name) }}>
              <h2>{loyaltyData.tierInfo.currentTier.name.toUpperCase()}</h2>
              <p>Member</p>
            </div>
            <div className="points-display">
              <h3>{loyaltyData.user.totalPoints.toLocaleString()}</h3>
              <p>Total Points</p>
            </div>
            <div className="tier-progress">
              {loyaltyData.tierInfo.nextTier ? (
                <>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${Math.min(loyaltyData.tierInfo.nextTier.progressPercentage, 100)}%` }}
                    ></div>
                  </div>
                  <p>
                    {Math.max(0, loyaltyData.tierInfo.nextTier.minPoints - loyaltyData.user.totalPoints).toLocaleString()} 
                    points to {loyaltyData.tierInfo.nextTier.name}
                  </p>
                </>
              ) : (
                <p>You've reached the highest tier! 🎉</p>
              )}
            </div>
          </div>

          <div className="stats-card">
            <h3>Your Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <h4>{loyaltyData.pointsSummary.totalEarned.toLocaleString()}</h4>
                <p>Points Earned</p>
              </div>
              <div className="stat-item">
                <h4>{loyaltyData.pointsSummary.totalRedeemed.toLocaleString()}</h4>
                <p>Points Redeemed</p>
              </div>
              <div className="stat-item">
                <h4>{loyaltyData.tierInfo.userStats.totalNights}</h4>
                <p>Nights Stayed</p>
              </div>
              <div className="stat-item">
                <h4>${loyaltyData.tierInfo.userStats.totalSpent.toLocaleString()}</h4>
                <p>Total Spent</p>
              </div>
            </div>
          </div>

          <div className="benefits-card">
            <h3>Your {loyaltyData.tierInfo.currentTier.name} Benefits</h3>
            <ul className="benefits-list">
              {loyaltyData.tierInfo.currentTier.benefits.map((benefit, index) => (
                <li key={index}>{benefit}</li>
              ))}
            </ul>
          </div>

          <div className="actions-card">
            <h3>Quick Actions</h3>
            <div className="actions-grid">
              <button className="action-btn">
                <span>📱</span>
                <p>View Rewards</p>
              </button>
              <button className="action-btn">
                <span>🎟️</span>
                <p>My Coupons</p>
              </button>
              <button className="action-btn">
                <span>📊</span>
                <p>Transaction History</p>
              </button>
              <button className="action-btn">
                <span>🏨</span>
                <p>Book Stay</p>
              </button>
            </div>
          </div>
        </div>

        {loyaltyData.recentTransactions.length > 0 && (
          <div className="transactions-section">
            <h3>Recent Transactions</h3>
            <div className="transactions-list">
              {loyaltyData.recentTransactions.map((transaction, index) => (
                <div key={index} className="transaction-item">
                  <div className="transaction-info">
                    <h4>{transaction.description}</h4>
                    <p>{new Date(transaction.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className={`transaction-amount ${transaction.pointsAmount > 0 ? 'positive' : 'negative'}`}>
                    {transaction.pointsAmount > 0 ? '+' : ''}{transaction.pointsAmount.toLocaleString()} points
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;