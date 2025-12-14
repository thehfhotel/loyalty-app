import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import MainLayout from '../../components/layout/MainLayout';
import { loyaltyService, AdminTransaction } from '../../services/loyaltyService';
import { logger } from '../../utils/logger';

export default function AdminTransactionHistoryPage() {
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
      const response = await loyaltyService.getAdminTransactions(100, 0);
      setTransactions(response.transactions);
      setTotal(response.total);
    } catch (error) {
      logger.error('Error loading transactions:', error);
      toast.error(t('errors.networkError'));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatName = (firstName: string | null | undefined, lastName: string | null | undefined) => {
    const parts = [firstName, lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : '-';
  };

  const formatChange = (value: number | null | undefined) => {
    if (value === null || value === undefined || value === 0) {return '-';}
    const sign = value > 0 ? '+' : '';
    return `${sign}${value}`;
  };

  if (loading) {
    return (
      <MainLayout title={t('admin.loyalty.transactionHistory')}>
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
            <p className="mt-4 text-gray-600">{t('profile.loading')}</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title={t('admin.loyalty.transactionHistory')}>
      <div className="bg-white shadow rounded-lg">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {t('admin.loyalty.transactionHistory')}
            </h2>
            <span className="text-sm text-gray-500">
              {t('common.showing')} {transactions.length} {t('common.of')} {total} {t('admin.loyalty.transactions')}
            </span>
          </div>
        </div>

        {/* Transaction Table */}
        <div className="overflow-x-auto">
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {t('admin.loyalty.noTransactions')}
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User Membership ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User Email
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Night Change
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Point Change
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Admin Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Admin Membership ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.user_membership_id ?? '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatName(transaction.user_first_name, transaction.user_last_name)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.user_email ?? '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={transaction.nights_stayed && transaction.nights_stayed > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                        {formatChange(transaction.nights_stayed)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={transaction.points > 0 ? 'text-green-600 font-medium' : transaction.points < 0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
                        {formatChange(transaction.points)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatName(transaction.admin_first_name, transaction.admin_last_name)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.admin_membership_id ?? '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(transaction.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
