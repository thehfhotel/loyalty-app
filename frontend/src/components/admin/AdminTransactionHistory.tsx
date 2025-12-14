import { useState, useEffect } from 'react';
import { FiUser } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { loyaltyService, AdminTransaction } from '../../services/loyaltyService';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';
import toast from 'react-hot-toast';
import { logger } from '../../utils/logger';

export default function AdminTransactionHistory() {
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const result = await loyaltyService.getAdminTransactions(20, 0);
      setTransactions(result.transactions);
      setTotal(result.total);
    } catch (error) {
      logger.error('Error loading admin transactions:', error);
      toast.error(t('errors.networkError'));
    } finally {
      setLoading(false);
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
    return `${dateOnly}, ${timeOnly}`;
  };

  const getUserDisplayName = (transaction: AdminTransaction) => {
    if (transaction.user_first_name ?? transaction.user_last_name) {
      return `${transaction.user_first_name ?? ''} ${transaction.user_last_name ?? ''}`.trim();
    }
    return transaction.user_email ?? t('common.unknown');
  };

  if (loading) {
    return (
      <div className="mt-6">
        <h4 className="text-sm font-medium text-gray-900 mb-3">
          {t('admin.loyalty.transactionHistory')}
        </h4>
        <div className="max-h-64 overflow-y-auto space-y-3">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="animate-pulse flex justify-between items-start text-sm border-b border-gray-100 pb-2">
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h4 className="text-sm font-medium text-gray-900 mb-3">
        {t('admin.loyalty.transactionHistory')}
      </h4>
      <div className="max-h-64 overflow-y-auto space-y-3">
        {transactions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            {t('loyalty.noTransactions')}
          </p>
        ) : (
          transactions.map((transaction) => (
            <div
              key={transaction.id}
              className="flex justify-between items-start text-sm border-b border-gray-100 pb-2 last:border-b-0"
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <div
                    className={`font-medium ${
                      transaction.points > 0 || (transaction.points === 0 && transaction.type === 'earned_stay')
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {transaction.points > 0 || (transaction.points === 0 && transaction.type === 'earned_stay')
                      ? '+' : ''}{transaction.points} pts
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {transaction.type}
                  </div>
                </div>
                <div className="mt-1 space-y-1">
                  <div className="text-xs text-gray-600">
                    {formatDate(transaction.created_at)}
                  </div>
                  {/* User Info */}
                  <div className="flex items-center space-x-1 text-xs text-gray-700">
                    <FiUser className="w-3 h-3" />
                    <span>{getUserDisplayName(transaction)}</span>
                  </div>
                  {/* Admin Info */}
                  {transaction.admin_email && (
                    <div className="flex items-center space-x-1 text-xs text-blue-600">
                      <FiUser className="w-3 h-3" />
                      <span title={`Adjusted by ${transaction.admin_email}`}>
                        Admin: {transaction.admin_email}
                      </span>
                    </div>
                  )}
                  {/* Admin Reason */}
                  {transaction.admin_reason &&
                   !transaction.admin_reason.toLowerCase().includes('thb') &&
                   !transaction.admin_reason.toLowerCase().includes('baht') &&
                   !transaction.admin_reason.toLowerCase().includes('฿') && (
                    <div className="text-xs text-gray-500 italic">
                      &ldquo;{transaction.admin_reason}&rdquo;
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {total > 20 && (
        <div className="mt-3 text-xs text-gray-500 text-center">
          {t('common.showing')} 20 {t('common.of')} {total} {t('admin.loyalty.transactions')}
        </div>
      )}
    </div>
  );
}
