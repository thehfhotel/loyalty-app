import { UserLoyaltyStatus } from '../../services/loyaltyService';
import { useTranslation } from 'react-i18next';
import { FiStar } from 'react-icons/fi';

interface PointsAndTierCardProps {
  loyaltyStatus: UserLoyaltyStatus;
}

export default function PointsAndTierCard({ loyaltyStatus }: PointsAndTierCardProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border-l-4 h-auto"
         style={{ borderLeftColor: loyaltyStatus.tier_color }}
    >
      {/* Points Balance Section */}
      <div className="flex items-center justify-between mb-6">
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

      {/* Tier Benefits Preview */}
      <div className="border-t pt-4">
        <div className="text-sm font-medium text-gray-700 mb-3">
          {t('loyalty.tierBenefits')}
        </div>
        {loyaltyStatus.tier_benefits?.perks && loyaltyStatus.tier_benefits.perks.length > 0 && (
          <ul className="space-y-2">
            {loyaltyStatus.tier_benefits.perks.map((perk, index) => (
              <li key={index} className="flex items-start space-x-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                      style={{ backgroundColor: loyaltyStatus.tier_color }}
                />
                <span className="text-sm text-gray-700">{perk}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
