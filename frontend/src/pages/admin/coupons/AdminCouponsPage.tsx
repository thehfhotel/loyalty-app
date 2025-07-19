import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Download,
  BarChart3,
  Settings,
  Users,
  TrendingUp
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { CreateCouponModal } from '../../../components/admin/coupons/CreateCouponModal';
import { AdminCouponCard } from '../../../components/admin/coupons/AdminCouponCard';
import { CouponAnalyticsModal } from '../../../components/admin/coupons/CouponAnalyticsModal';
import { DistributionModal } from '../../../components/admin/coupons/DistributionModal';
import { adminCouponService, type AdminCoupon } from '../../../services/adminCouponService';
import toast from 'react-hot-toast';

type TabType = 'all' | 'active' | 'expired' | 'draft';

const AdminCouponsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  
  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCouponForAnalytics, setSelectedCouponForAnalytics] = useState<AdminCoupon | null>(null);
  const [selectedCouponForDistribution, setSelectedCouponForDistribution] = useState<AdminCoupon | null>(null);

  useEffect(() => {
    loadCoupons();
  }, []);

  const loadCoupons = async () => {
    setIsLoading(true);
    try {
      const couponsData = await adminCouponService.getAllCoupons();
      setCoupons(couponsData);
    } catch (error) {
      toast.error('Failed to load coupons');
      console.error('Error loading coupons:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCoupon = async (couponData: any) => {
    try {
      await adminCouponService.createCoupon(couponData);
      toast.success('Coupon created successfully');
      setIsCreateModalOpen(false);
      await loadCoupons();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create coupon');
    }
  };

  const handleDistributeCoupon = (coupon: AdminCoupon) => {
    setSelectedCouponForDistribution(coupon);
  };

  const handleViewAnalytics = (coupon: AdminCoupon) => {
    setSelectedCouponForAnalytics(coupon);
  };

  const handleToggleStatus = async (couponId: string, isActive: boolean) => {
    try {
      await adminCouponService.updateCouponStatus(couponId, isActive);
      toast.success(`Coupon ${isActive ? 'activated' : 'deactivated'} successfully`);
      await loadCoupons();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update coupon status');
    }
  };

  const getFilteredCoupons = () => {
    let filtered = coupons;

    // Filter by tab
    const now = new Date();
    switch (activeTab) {
      case 'active':
        filtered = coupons.filter(coupon => 
          coupon.isActive && new Date(coupon.validUntil) > now
        );
        break;
      case 'expired':
        filtered = coupons.filter(coupon => new Date(coupon.validUntil) <= now);
        break;
      case 'draft':
        filtered = coupons.filter(coupon => !coupon.isActive);
        break;
      default:
        // 'all' - no additional filtering
        break;
    }

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(coupon =>
        coupon.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coupon.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coupon.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(coupon => coupon.category === categoryFilter);
    }

    return filtered;
  };

  const getStats = () => {
    const now = new Date();
    const active = coupons.filter(c => c.isActive && new Date(c.validUntil) > now).length;
    const expired = coupons.filter(c => new Date(c.validUntil) <= now).length;
    const draft = coupons.filter(c => !c.isActive).length;
    const totalRedemptions = coupons.reduce((sum, c) => sum + c.usageCount, 0);

    return { active, expired, draft, totalRedemptions };
  };

  const handleExportData = () => {
    // Export functionality would be implemented here
    toast.info('Export functionality coming soon!');
  };

  const stats = getStats();
  const filteredCoupons = getFilteredCoupons();

  const tabs = [
    { id: 'active' as TabType, label: 'Active', count: stats.active },
    { id: 'draft' as TabType, label: 'Draft', count: stats.draft },
    { id: 'expired' as TabType, label: 'Expired', count: stats.expired },
    { id: 'all' as TabType, label: 'All', count: coupons.length }
  ];

  const categories = [
    { value: 'all', label: 'All Categories' },
    { value: 'room', label: 'Room & Accommodation' },
    { value: 'dining', label: 'Dining & Restaurant' },
    { value: 'spa', label: 'Spa & Wellness' },
    { value: 'experience', label: 'Experiences & Activities' },
    { value: 'general', label: 'General' }
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Coupon Management</h1>
          <p className="text-gray-600 mt-1">Create, manage, and analyze your coupons</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            leftIcon={<Download className="w-4 h-4" />}
            onClick={handleExportData}
          >
            Export
          </Button>
          <Button
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCreateModalOpen(true)}
          >
            Create Coupon
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Coupons</p>
                <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              </div>
              <div className="bg-green-100 p-2 rounded-lg">
                <Settings className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Draft Coupons</p>
                <p className="text-2xl font-bold text-orange-600">{stats.draft}</p>
              </div>
              <div className="bg-orange-100 p-2 rounded-lg">
                <Filter className="w-5 h-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Redemptions</p>
                <p className="text-2xl font-bold text-blue-600">{stats.totalRedemptions}</p>
              </div>
              <div className="bg-blue-100 p-2 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Expired</p>
                <p className="text-2xl font-bold text-red-600">{stats.expired}</p>
              </div>
              <div className="bg-red-100 p-2 rounded-lg">
                <BarChart3 className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                <Badge variant="secondary" size="sm">
                  {tab.count}
                </Badge>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search coupons..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="sm:w-64">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input"
          >
            {categories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" text="Loading coupons..." />
        </div>
      ) : filteredCoupons.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No coupons found
            </h3>
            <p className="text-gray-600 mb-4">
              {searchQuery || categoryFilter !== 'all' 
                ? 'Try adjusting your search or filters.'
                : 'Get started by creating your first coupon.'}
            </p>
            {!searchQuery && categoryFilter === 'all' && (
              <Button
                variant="primary"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={() => setIsCreateModalOpen(true)}
              >
                Create First Coupon
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCoupons.map((coupon) => (
            <AdminCouponCard
              key={coupon.id}
              coupon={coupon}
              onViewAnalytics={handleViewAnalytics}
              onDistribute={handleDistributeCoupon}
              onToggleStatus={handleToggleStatus}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <CreateCouponModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateCoupon={handleCreateCoupon}
      />

      {selectedCouponForAnalytics && (
        <CouponAnalyticsModal
          isOpen={!!selectedCouponForAnalytics}
          onClose={() => setSelectedCouponForAnalytics(null)}
          coupon={selectedCouponForAnalytics}
        />
      )}

      {selectedCouponForDistribution && (
        <DistributionModal
          isOpen={!!selectedCouponForDistribution}
          onClose={() => setSelectedCouponForDistribution(null)}
          coupon={selectedCouponForDistribution}
          onDistribute={loadCoupons}
        />
      )}
    </div>
  );
};

export default AdminCouponsPage;