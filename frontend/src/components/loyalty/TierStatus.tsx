import { UserLoyaltyStatus, Tier } from '../../services/loyaltyService';
import { useTranslation } from 'react-i18next';
import { FiChevronUp, FiAward } from 'react-icons/fi';

interface TierStatusProps {
  loyaltyStatus: UserLoyaltyStatus;
  allTiers: Tier[];
}

export default function TierStatus({ loyaltyStatus, allTiers }: TierStatusProps) {
  const { t } = useTranslation();

  const currentTierIndex = allTiers.findIndex(tier => tier.name === loyaltyStatus.tier_name);
  const isTopTier = currentTierIndex === allTiers.length - 1;

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
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('loyalty.tierStatus')}
        </h3>
        <div className="flex items-center space-x-2">
          <FiAward className="w-5 h-5" style={{ color: loyaltyStatus.tier_color }} />
          <span className="font-medium" style={{ color: loyaltyStatus.tier_color }}>
            {loyaltyStatus.tier_name}
          </span>
        </div>
      </div>

      {/* Tier Progress */}
      <div className="space-y-4">
        {allTiers.map((tier, index) => {
          const isCurrentTier = tier.name === loyaltyStatus.tier_name;
          const isCompleted = index < currentTierIndex || isCurrentTier;
          const isNext = index === currentTierIndex + 1;

          return (
            <div key={tier.id} className="flex items-center space-x-4">
              {/* Tier Icon */}
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center border-2
                ${isCompleted 
                  ? 'border-transparent' 
                  : isNext 
                    ? 'border-gray-300 border-dashed' 
                    : 'border-gray-200'
                }
              `}
style={{
                backgroundColor: isCompleted ? tier.color : isNext ? `${tier.color}20` : '#f9fafb'
              }}
              >
                <FiAward className={`w-5 h-5 ${
                  isCompleted ? 'text-white' : isNext ? 'text-gray-600' : 'text-gray-400'
                }`}
                />
              </div>

              {/* Tier Info */}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${
                    isCurrentTier ? 'text-gray-900' : isCompleted ? 'text-gray-700' : 'text-gray-500'
                  }`}
                  >
                    {tier.name}
                  </span>
                  <span className={`text-sm ${
                    isCurrentTier ? 'text-gray-900' : 'text-gray-500'
                  }`}
                  >
                    {tier.min_nights === 0 ? t('loyalty.newMember') : `${tier.min_nights.toLocaleString()}+ ${tier.min_nights === 1 ? t('loyalty.night') : t('loyalty.nights')}`}
                  </span>
                </div>

                {/* Progress Bar for Next Tier */}
                {isNext && loyaltyStatus.progress_percentage !== null && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>
                        {loyaltyStatus.nights_to_next_tier !== null
                          ? `${loyaltyStatus.nights_to_next_tier} ${loyaltyStatus.nights_to_next_tier === 1 ? t('loyalty.nightToGo') : t('loyalty.nightsToGo')}`
                          : t('loyalty.maxTierReached')
                        }
                      </span>
                      <span>
                        {getProgressPercentage().toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="h-2 rounded-full transition-all duration-300"
                        style={{ 
                          width: `${getProgressPercentage()}%`,
                          backgroundColor: tier.color
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Current Tier Indicator */}
                {isCurrentTier && (
                  <div className="mt-1 flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tier.color }} />
                    <span className="text-xs text-gray-600">{t('loyalty.currentTier')}</span>
                  </div>
                )}
              </div>

              {/* Next Tier Arrow */}
              {isNext && (
                <FiChevronUp className="w-4 h-4 text-gray-400" />
              )}
            </div>
          );
        })}
      </div>

      {/* Next Tier Benefits Preview */}
      {!isTopTier && loyaltyStatus.next_tier_name && (
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="text-sm font-medium text-gray-700 mb-2">
            {t('loyalty.nextTierBenefits', { tier: loyaltyStatus.next_tier_name })}
          </div>
          <div className="text-xs text-gray-600">
            {loyaltyStatus.nights_to_next_tier !== null
              ? t('loyalty.unlockBenefitsNights', { nights: loyaltyStatus.nights_to_next_tier })
              : t('loyalty.maxTierReached')}
          </div>
        </div>
      )}

      {/* Top Tier Message */}
      {isTopTier && (
        <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: `${loyaltyStatus.tier_color}10` }}>
          <div className="text-sm font-medium" style={{ color: loyaltyStatus.tier_color }}>
            🎉 {t('loyalty.topTierMessage')}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {t('loyalty.topTierDescription')}
          </div>
        </div>
      )}
    </div>
  );
}