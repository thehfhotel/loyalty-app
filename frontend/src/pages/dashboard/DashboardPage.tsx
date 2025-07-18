import React from 'react';
import { Award, Gift, TrendingUp, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../store/authStore';

const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();

  // Mock data
  const stats = {
    totalPoints: 12450,
    availableCoupons: 3,
    currentTier: user?.tier || 'bronze',
    nextTierPoints: 2550,
  };

  const recentActivity = [
    { id: 1, type: 'points_earned', description: 'Hotel stay bonus', points: 500, date: '2 days ago' },
    { id: 2, type: 'coupon_redeemed', description: 'Spa discount used', points: -200, date: '1 week ago' },
    { id: 3, type: 'tier_upgrade', description: 'Upgraded to Gold tier', points: 0, date: '2 weeks ago' },
  ];

  const availableCoupons = [
    { id: 1, title: '20% Off Spa Services', description: 'Valid until Dec 31', value: '$50' },
    { id: 2, title: 'Free Room Upgrade', description: 'Next stay upgrade', value: '$100' },
    { id: 3, title: 'Complimentary Breakfast', description: 'For 2 guests', value: '$30' },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.firstName}!
          </h1>
          <p className="text-gray-600 mt-1">
            Here's your loyalty program overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="tier" tier={user?.tier} size="lg">
            {user?.tier?.toUpperCase()} MEMBER
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Points</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalPoints.toLocaleString()}</p>
              </div>
              <div className="bg-primary-100 p-3 rounded-full">
                <Award className="w-6 h-6 text-primary-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Available Coupons</p>
                <p className="text-2xl font-bold text-gray-900">{stats.availableCoupons}</p>
              </div>
              <div className="bg-secondary-100 p-3 rounded-full">
                <Gift className="w-6 h-6 text-secondary-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Current Tier</p>
                <p className="text-lg font-bold text-gray-900 capitalize">{stats.currentTier}</p>
              </div>
              <div className="bg-accent-100 p-3 rounded-full">
                <Users className="w-6 h-6 text-accent-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">To Next Tier</p>
                <p className="text-2xl font-bold text-gray-900">{stats.nextTierPoints}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-full">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between py-2">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{activity.description}</p>
                  <p className="text-sm text-gray-500">{activity.date}</p>
                </div>
                {activity.points !== 0 && (
                  <span className={`font-medium ${
                    activity.points > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {activity.points > 0 ? '+' : ''}{activity.points} pts
                  </span>
                )}
              </div>
            ))}
            <Button variant="ghost" fullWidth className="mt-4">
              View All Activity
            </Button>
          </CardContent>
        </Card>

        {/* Available Coupons */}
        <Card>
          <CardHeader>
            <CardTitle>Available Coupons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {availableCoupons.map((coupon) => (
              <div key={coupon.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{coupon.title}</h4>
                  <Badge variant="success" size="sm">{coupon.value}</Badge>
                </div>
                <p className="text-sm text-gray-600 mb-2">{coupon.description}</p>
                <Button size="sm" variant="ghost">
                  Use Coupon
                </Button>
              </div>
            ))}
            <Button variant="secondary" fullWidth className="mt-4">
              View All Coupons
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Button variant="primary" className="h-20 flex-col">
              <Award className="w-6 h-6 mb-2" />
              <span>View Rewards</span>
            </Button>
            <Button variant="secondary" className="h-20 flex-col">
              <Gift className="w-6 h-6 mb-2" />
              <span>Browse Coupons</span>
            </Button>
            <Button variant="ghost" className="h-20 flex-col">
              <TrendingUp className="w-6 h-6 mb-2" />
              <span>Track Progress</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardPage;