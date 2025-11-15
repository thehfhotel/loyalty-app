import { UserLoyaltyStatus } from '../../services/loyaltyService';
import { useTranslation } from 'react-i18next';
import { FiStar, FiAward } from 'react-icons/fi';

interface PointsAndTierCardProps {
  loyaltyStatus: UserLoyaltyStatus;
}

export default function PointsAndTierCard({ loyaltyStatus }: PointsAndTierCardProps) {
  const { t } = useTranslation();

  // Helper function to safely convert progress_percentage to number
  const getProgressPercentage = () => {
    try {
      const percentage = Number(loyaltyStatus.progress_percentage);
      return isNaN(percentage) ? 0 : percentage;
    } catch (error) {
      console.warn('Error converting progress_percentage to number:', error);
      return 0;
    }
  };

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
      <div className="border-t pt-4 mb-6">
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

      {/* Current Tier & Progress Section */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-gray-900">
            {t('loyalty.tierStatus')}
          </h4>
          <div className="flex items-center space-x-2">
            <FiAward className="w-4 h-4" style={{ color: loyaltyStatus.tier_color }} />
            <span className="text-sm font-medium" style={{ color: loyaltyStatus.tier_color }}>
              {loyaltyStatus.tier_name}
            </span>
          </div>
        </div>

        {/* Progress to Next Tier */}
        {loyaltyStatus.next_tier_name && loyaltyStatus.progress_percentage !== null ? (
          <div>
            <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
              <span className="flex items-center space-x-1">
                <span>{t('loyalty.progressToNextTier', { tier: loyaltyStatus.next_tier_name })}</span>
              </span>
              <span className="font-medium">
                {loyaltyStatus.nights_to_next_tier !== null
                  ? `${loyaltyStatus.nights_to_next_tier} ${loyaltyStatus.nights_to_next_tier === 1 ? t('loyalty.nightToGo') : t('loyalty.nightsToGo')}`
                  : ''}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${getProgressPercentage()}%`,
                  backgroundColor: loyaltyStatus.tier_color
                }}
              />
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-lg" style={{ backgroundColor: `${loyaltyStatus.tier_color}10` }}>
            <div className="text-sm font-medium" style={{ color: loyaltyStatus.tier_color }}>
              🎉 {t('loyalty.topTierMessage')}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {t('loyalty.topTierDescription')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
