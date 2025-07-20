import { UserLoyaltyStatus } from '../../services/loyaltyService';
import { useTranslation } from 'react-i18next';
import { FiStar, FiTrendingUp } from 'react-icons/fi';

interface PointsBalanceProps {
  loyaltyStatus: UserLoyaltyStatus;
  expiringPoints?: number;
  nextExpiryDate?: string | null;
}

export default function PointsBalance({ 
  loyaltyStatus, 
  expiringPoints = 0, 
  nextExpiryDate 
}: PointsBalanceProps) {
  const { t } = useTranslation();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border-l-4" 
         style={{ borderLeftColor: loyaltyStatus.tier_color }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: `${loyaltyStatus.tier_color}20` }}>
            <FiStar className="w-6 h-6" style={{ color: loyaltyStatus.tier_color }} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {t('loyalty.pointsBalance')}
            </h3>
            <p className="text-sm text-gray-600">
              {loyaltyStatus.tier_name} {t('loyalty.member')}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold" style={{ color: loyaltyStatus.tier_color }}>
            {loyaltyStatus.current_points.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600">
            {t('loyalty.availablePoints')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <FiTrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium text-gray-700">
              {t('loyalty.lifetimePoints')}
            </span>
          </div>
          <div className="text-xl font-semibold text-gray-900 mt-1">
            {loyaltyStatus.lifetime_points.toLocaleString()}
          </div>
        </div>
        
        {expiringPoints > 0 && (
          <div className="bg-yellow-50 rounded-lg p-3">
            <div className="text-sm font-medium text-yellow-800">
              {t('loyalty.expiringPoints')}
            </div>
            <div className="text-xl font-semibold text-yellow-900 mt-1">
              {expiringPoints.toLocaleString()}
            </div>
            {nextExpiryDate && (
              <div className="text-xs text-yellow-700 mt-1">
                {t('loyalty.expiresOn')} {formatDate(nextExpiryDate)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tier Benefits Preview */}
      <div className="border-t pt-4">
        <div className="text-sm font-medium text-gray-700 mb-2">
          {t('loyalty.tierBenefits')}
        </div>
        <div className="text-sm text-gray-600">
          {loyaltyStatus.tier_benefits?.description || t('loyalty.noDescription')}
        </div>
        {loyaltyStatus.tier_benefits?.perks && loyaltyStatus.tier_benefits.perks.length > 0 && (
          <div className="mt-2">
            <ul className="text-xs text-gray-600 space-y-1">
              {loyaltyStatus.tier_benefits.perks.slice(0, 2).map((perk, index) => (
                <li key={index} className="flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full" 
                        style={{ backgroundColor: loyaltyStatus.tier_color }}></span>
                  <span>{perk}</span>
                </li>
              ))}
              {loyaltyStatus.tier_benefits.perks.length > 2 && (
                <li className="text-gray-500">
                  +{loyaltyStatus.tier_benefits.perks.length - 2} {t('loyalty.moreBenefits')}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}