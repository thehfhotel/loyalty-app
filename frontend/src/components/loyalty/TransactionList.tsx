import { PointsTransaction } from '../../services/loyaltyService';
import { useTranslation } from 'react-i18next';
import { FiPlus, FiMinus, FiClock, FiUser } from 'react-icons/fi';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';

interface TransactionListProps {
  transactions: PointsTransaction[];
  isLoading?: boolean;
  showLoadMore?: boolean;
  onLoadMore?: () => void;
  showAdminInfo?: boolean; // New prop to control admin info visibility
}

export default function TransactionList({ 
  transactions, 
  isLoading = false, 
  showLoadMore = false, 
  onLoadMore,
  showAdminInfo = false // Default to false - don't show admin info unless explicitly requested
}: TransactionListProps) {
  const { t } = useTranslation();

  const getTransactionIcon = (points: number) => {
    if (points > 0) {
      return <FiPlus className="w-4 h-4 text-green-600" />;
    } else {
      return <FiMinus className="w-4 h-4 text-red-600" />;
    }
  };

  const getTransactionColor = (points: number) => {
    if (points > 0) {
      return 'text-green-600';
    } else {
      return 'text-red-600';
    }
  };

  const getPointsFocusedDescription = (transaction: PointsTransaction) => {
    // Always focus on points gained/lost rather than any spending amounts
    if (transaction.points > 0) {
      // Positive points - focus on earning
      switch (transaction.type) {
        case 'earned_stay':
        case 'stay_earning':
          return `${t('loyalty.transactionTypes.earnedStay')}`;
        case 'earned_bonus':
          return `${t('loyalty.transactionTypes.earnedBonus')}`;
        case 'admin_award':
          return `${t('loyalty.transactionTypes.adminAward')}`;
        default:
          return `${t('loyalty.pointsEarned')}`;
      }
    } else {
      // Negative points - focus on usage/deduction
      switch (transaction.type) {
        case 'redeemed':
          return `${t('loyalty.transactionTypes.redeemed')}`;
        case 'expired':
          return `${t('loyalty.transactionTypes.expired')}`;
        case 'admin_deduction':
          return `${t('loyalty.transactionTypes.adminDeduction')}`;
        default:
          return `${t('loyalty.pointsDeducted')}`;
      }
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const dateOnly = formatDateToDDMMYYYY(date);
    const timeOnly = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return `${dateOnly} ${timeOnly}`;
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {t('loyalty.transactionHistory')}
        </h3>
        <div className="space-y-4">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                </div>
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {t('loyalty.transactionHistory')}
      </h3>

      {transactions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <FiClock className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p>{t('loyalty.noTransactions')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {transactions.map((transaction) => (
            <div key={transaction.id} className="flex items-center space-x-4 py-3 border-b border-gray-100 last:border-b-0">
              {/* Transaction Icon */}
              <div className={`
                w-10 h-10 rounded-lg flex items-center justify-center
                ${transaction.points > 0 ? 'bg-green-50' : 'bg-red-50'}
              `}
              >
                {getTransactionIcon(transaction.points)}
              </div>

              {/* Transaction Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-900 truncate">
                    {getPointsFocusedDescription(transaction)}
                  </p>
                  <p className={`font-semibold ${getTransactionColor(transaction.points)}`}>
                    {transaction.points > 0 ? '+' : ''}{transaction.points.toLocaleString()} {t('loyalty.points')}
                  </p>
                </div>
                
                <div className="flex items-center space-x-4 mt-1">
                  <p className="text-sm text-gray-600">
                    {formatDate(transaction.created_at)}
                  </p>
                  
                  {showAdminInfo && transaction.admin_email && (
                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                      <FiUser className="w-3 h-3" />
                      <span>{transaction.admin_email}</span>
                    </div>
                  )}
                  
                  {transaction.expires_at && (
                    <div className="text-xs text-yellow-600">
                      {t('loyalty.expires')} {formatDate(transaction.expires_at)}
                    </div>
                  )}
                </div>

                {transaction.admin_reason && !transaction.admin_reason.toLowerCase().includes('thb') && !transaction.admin_reason.toLowerCase().includes('baht') && !transaction.admin_reason.toLowerCase().includes('฿') && (
                  <p className="text-xs text-gray-500 mt-1 italic">
                    {transaction.admin_reason}
                  </p>
                )}
              </div>
            </div>
          ))}

          {showLoadMore && (
            <div className="text-center pt-4">
              <button
                onClick={onLoadMore}
                className="px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
              >
                {t('common.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}