import React, { useState, useEffect } from 'react';
import { Ticket, Plus, Search, Filter, Gift, QrCode, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { CouponCard } from '../../components/coupons/CouponCard';
import { QRCodeModal } from '../../components/coupons/QRCodeModal';
import { CouponRedemptionModal } from '../../components/coupons/CouponRedemptionModal';
import { 
  couponService, 
  Coupon, 
  CouponWithCustomerInfo 
} from '../../services/couponService';
import toast from 'react-hot-toast';

type TabType = 'available' | 'my-coupons' | 'used';

const CouponsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('my-coupons');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  
  // Data states
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>([]);
  const [myCoupons, setMyCoupons] = useState<CouponWithCustomerInfo[]>([]);
  
  // Modal states
  const [selectedCouponForQR, setSelectedCouponForQR] = useState<Coupon | null>(null);
  const [selectedCouponForRedemption, setSelectedCouponForRedemption] = useState<Coupon | null>(null);

  useEffect(() => {
    loadCoupons();
  }, [activeTab]);

  const loadCoupons = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'available') {
        const coupons = await couponService.getAvailableCoupons();
        setAvailableCoupons(coupons);
      } else {
        const coupons = await couponService.getCustomerCoupons();
        setMyCoupons(coupons);
      }
    } catch (error) {
      toast.error('Failed to load coupons');
      console.error('Error loading coupons:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCoupon = async (coupon: Coupon) => {
    try {
      // This would typically call an API to add the coupon to user's wallet
      // For now, we'll just show a success message and refresh
      toast.success('Coupon added to your wallet!');
      
      // Switch to my-coupons tab and refresh
      setActiveTab('my-coupons');
      await loadCoupons();
    } catch (error) {
      toast.error('Failed to add coupon to wallet');
    }
  };

  const handleRedeemCoupon = (coupon: Coupon) => {
    setSelectedCouponForRedemption(coupon);
  };

  const handleViewQR = (coupon: Coupon) => {
    setSelectedCouponForQR(coupon);
  };

  const handleRedemptionSuccess = () => {
    loadCoupons();
  };

  const getFilteredCoupons = () => {
    let coupons: Coupon[] = [];
    
    if (activeTab === 'available') {
      coupons = availableCoupons;
    } else if (activeTab === 'my-coupons') {
      coupons = myCoupons
        .filter(item => !item.customerCoupon.isUsed)
        .map(item => item.coupon);
    } else if (activeTab === 'used') {
      coupons = myCoupons
        .filter(item => item.customerCoupon.isUsed)
        .map(item => item.coupon);
    }

    // Apply search filter
    if (searchQuery) {
      coupons = coupons.filter(coupon =>
        coupon.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coupon.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coupon.code.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply category filter
    if (categoryFilter !== 'all') {
      coupons = coupons.filter(coupon => coupon.category === categoryFilter);
    }

    return coupons;
  };

  const getCustomerCouponInfo = (couponId: string) => {
    return myCoupons.find(item => item.coupon.id === couponId)?.customerCoupon;
  };

  const tabs = [
    { id: 'my-coupons' as TabType, label: 'My Coupons', icon: Ticket },
    { id: 'available' as TabType, label: 'Available', icon: Gift },
    { id: 'used' as TabType, label: 'Used', icon: Calendar }
  ];

  const categories = [
    { value: 'all', label: 'All Categories' },
    { value: 'room', label: 'Room & Accommodation' },
    { value: 'dining', label: 'Dining & Restaurant' },
    { value: 'spa', label: 'Spa & Wellness' },
    { value: 'experience', label: 'Experiences & Activities' },
    { value: 'general', label: 'General' }
  ];

  const filteredCoupons = getFilteredCoupons();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
          <p className="text-gray-600 mt-1">Manage your coupons and exclusive offers</p>
        </div>
        <Button
          variant="secondary"
          leftIcon={<QrCode className="w-4 h-4" />}
          onClick={() => {
            // QR scanner functionality would go here
            toast.info('QR scanner coming soon!');
          }}
        >
          Scan QR
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
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
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'my-coupons' && (
                  <Badge variant="secondary" size="sm">
                    {myCoupons.filter(item => !item.customerCoupon.isUsed).length}
                  </Badge>
                )}
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
            <Gift className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {activeTab === 'available' ? 'No available coupons' : 
               activeTab === 'my-coupons' ? 'No coupons in your wallet' : 
               'No used coupons'}
            </h3>
            <p className="text-gray-600">
              {activeTab === 'available' 
                ? 'Check back later for new offers and deals.'
                : activeTab === 'my-coupons'
                ? 'Browse available coupons to add them to your wallet.'
                : 'Your redeemed coupons will appear here.'}
            </p>
            {activeTab === 'my-coupons' && (
              <Button
                variant="primary"
                className="mt-4"
                onClick={() => setActiveTab('available')}
              >
                Browse Available Coupons
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCoupons.map((coupon) => (
            <CouponCard
              key={coupon.id}
              coupon={coupon}
              customerCoupon={getCustomerCouponInfo(coupon.id)}
              variant={activeTab === 'available' ? 'available' : 
                      activeTab === 'used' ? 'used' : 'owned'}
              onRedeem={activeTab === 'available' ? handleAddCoupon : handleRedeemCoupon}
              onViewQR={handleViewQR}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <QRCodeModal
        isOpen={!!selectedCouponForQR}
        onClose={() => setSelectedCouponForQR(null)}
        coupon={selectedCouponForQR!}
      />

      <CouponRedemptionModal
        isOpen={!!selectedCouponForRedemption}
        onClose={() => setSelectedCouponForRedemption(null)}
        coupon={selectedCouponForRedemption!}
        onRedemptionSuccess={handleRedemptionSuccess}
      />
    </div>
  );
};

export default CouponsPage;