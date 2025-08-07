import { UserLoyaltyStatus } from '../../services/loyaltyService';
import { useTranslation } from 'react-i18next';
import { FiStar } from 'react-icons/fi';

interface PointsBalanceProps {
  loyaltyStatus: UserLoyaltyStatus;
  // Legacy props kept for compatibility but no longer used since points never expire
  expiringPoints?: number;
  nextExpiryDate?: string | null;
}

export default function PointsBalance({ 
  loyaltyStatus
}: PointsBalanceProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border-l-4" 
         style={{ borderLeftColor: loyaltyStatus.tier_color }}
    >
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

      {/* Points never expire - no expiration display needed */}

      {/* Tier Benefits Preview */}
      <div className="border-t pt-4">
        <div className="text-sm font-medium text-gray-700 mb-2">
          {t('loyalty.tierBenefits')}
        </div>
        <div className="text-sm text-gray-600">
          {loyaltyStatus.tier_benefits?.description ?? t('loyalty.noDescription')}
        </div>
        {loyaltyStatus.tier_benefits?.perks && loyaltyStatus.tier_benefits.perks.length > 0 && (
          <div className="mt-2">
            <ul className="text-xs text-gray-600 space-y-1">
              {loyaltyStatus.tier_benefits.perks.slice(0, 2).map((perk, index) => (
                <li key={index} className="flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full" 
                        style={{ backgroundColor: loyaltyStatus.tier_color }}
                  />
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