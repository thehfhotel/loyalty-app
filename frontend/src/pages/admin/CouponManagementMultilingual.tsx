import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Coupon, CreateCouponRequest, CouponType } from '../../types/coupon';
import { SupportedLanguage } from '../../types/multilingual';
import { couponService } from '../../services/couponService';
import { translationService } from '../../services/translationService';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageTabs from '../../components/translation/LanguageTabs';
import TranslationButton from '../../components/translation/TranslationButton';
import CouponAssignmentsModal from '../../components/admin/CouponAssignmentsModal';
import toast from 'react-hot-toast';

const CouponManagementMultilingual: React.FC = () => {
  const { t } = useTranslation();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAssignmentsModal, setShowAssignmentsModal] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [createModalError, setCreateModalError] = useState<string | null>(null);

  // Translation state
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>('th');
  const [availableLanguages, setAvailableLanguages] = useState<SupportedLanguage[]>(['th']);
  const [translationStatus, setTranslationStatus] = useState<{ [key in SupportedLanguage]?: 'original' | 'translated' | 'pending' | 'error' }>({
    'th': 'original'
  });
  const [translating, setTranslating] = useState(false);

  // Create coupon form state with multilingual support
  const [multilingualCouponData, setMultilingualCouponData] = useState<{
    name: { [key in SupportedLanguage]?: string };
    description: { [key in SupportedLanguage]?: string };
    termsAndConditions: { [key in SupportedLanguage]?: string };
  }>({
    name: { th: '' },
    description: { th: '' },
    termsAndConditions: { th: '' }
  });

  const [newCoupon, setNewCoupon] = useState<CreateCouponRequest>({
    code: '',
    name: '',
    description: '',
    type: 'percentage',
    value: 0,
    minimumSpend: 0,
    maximumDiscount: 0,
    usageLimit: 100,
    usageLimitPerUser: 1,
    validFrom: new Date().toISOString().split('T')[0],
    validUntil: '',
    termsAndConditions: ''
  });

  useEffect(() => {
    loadCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    // Update displayed form data when language changes
    if (showCreateModal) {
      setNewCoupon(prev => ({
        ...prev,
        name: multilingualCouponData.name[currentLanguage] ?? '',
        description: multilingualCouponData.description[currentLanguage] ?? '',
        termsAndConditions: multilingualCouponData.termsAndConditions[currentLanguage] ?? ''
      }));
    }
  }, [currentLanguage, multilingualCouponData, showCreateModal]);

  const loadCoupons = async (pageNum: number = 1) => {
    try {
      setLoading(true);
      setError(null);
      const response = await couponService.getCoupons(pageNum, 10);
      setCoupons(response.coupons);
      setTotalPages(response.totalPages);
    } catch (err) {
      setError(t('coupons.admin.errors.loadFailed'));
      console.error('Failed to load coupons:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCouponTranslations = async (couponId: string, languages: SupportedLanguage[]) => {
    try {
      const translations: { [key in SupportedLanguage]?: Coupon } = {};
      
      for (const language of languages) {
        try {
          const translatedCoupon = await couponService.getCouponWithTranslations(couponId);
          if (translatedCoupon) {
            translations[language] = translatedCoupon;
          }
        } catch (error) {
          console.warn(`Failed to load ${language} translation:`, error);
        }
      }
      
      // Update multilingual data with translations
      const newMultilingualData = { ...multilingualCouponData };
      const newTranslationStatus = { ...translationStatus };
      
      Object.entries(translations).forEach(([lang, data]) => {
        const language = lang as SupportedLanguage;
        if (data) {
          newMultilingualData.name[language] = data.name;
          newMultilingualData.description[language] = data.description ?? '';
          newMultilingualData.termsAndConditions[language] = data.termsAndConditions ?? '';
          newTranslationStatus[language] = 'translated';
        }
      });
      
      setMultilingualCouponData(newMultilingualData);
      setTranslationStatus(newTranslationStatus);
      
    } catch (error) {
      console.error('Failed to load coupon translations:', error);
    }
  };

  const updateCurrentLanguageData = () => {
    if (showCreateModal) {
      setMultilingualCouponData(prev => ({
        ...prev,
        name: { ...prev.name, [currentLanguage]: newCoupon.name },
        description: { ...prev.description, [currentLanguage]: newCoupon.description ?? '' },
        termsAndConditions: { ...prev.termsAndConditions, [currentLanguage]: newCoupon.termsAndConditions ?? '' }
      }));
    }
  };

  const handleLanguageChange = (language: SupportedLanguage) => {
    updateCurrentLanguageData();
    setCurrentLanguage(language);
  };

  const handleTranslateCoupon = async (couponId: string, targetLanguages: SupportedLanguage[]) => {
    try {
      setTranslating(true);
      
      // Update translation status to pending for target languages
      const newStatus = { ...translationStatus };
      targetLanguages.forEach(lang => {
        newStatus[lang] = 'pending';
      });
      setTranslationStatus(newStatus);

      // Start translation job
      const translationJob = await translationService.translateCoupon(
        couponId,
        currentLanguage,
        targetLanguages
      );

      toast.success(t('translation.translationStarted'));

      // Poll for completion
      pollTranslationProgress(translationJob.id, targetLanguages, couponId);

    } catch (error) {
      console.error('Translation failed:', error);
      toast.error(t('translation.translationFailed'));
      
      // Reset status on error
      const newStatus = { ...translationStatus };
      targetLanguages.forEach(lang => {
        newStatus[lang] = 'error';
      });
      setTranslationStatus(newStatus);
    } finally {
      setTranslating(false);
    }
  };

  const pollTranslationProgress = async (jobId: string, targetLanguages: SupportedLanguage[], couponId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const job = await translationService.getTranslationJobStatus(jobId);
        
        if (job.status === 'completed') {
          clearInterval(pollInterval);
          
          // Update status to completed
          const newStatus = { ...translationStatus };
          targetLanguages.forEach(lang => {
            newStatus[lang] = 'translated';
          });
          setTranslationStatus(newStatus);
          
          // Add new languages to available languages
          const newAvailableLanguages = [...new Set([...availableLanguages, ...targetLanguages])];
          setAvailableLanguages(newAvailableLanguages);
          
          // Reload translations
          await loadCouponTranslations(couponId, newAvailableLanguages);
          
          toast.success(t('translation.translationCompleted'));
          
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          
          const newStatus = { ...translationStatus };
          targetLanguages.forEach(lang => {
            newStatus[lang] = 'error';
          });
          setTranslationStatus(newStatus);
          
          toast.error(t('translation.translationFailed'));
        }
        
      } catch (error) {
        console.error('Failed to check translation status:', error);
        clearInterval(pollInterval);
      }
    }, 2000);

    // Clear interval after 5 minutes to prevent infinite polling
    setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
  };

  const handleCreateCoupon = async () => {
    updateCurrentLanguageData();

    if (!newCoupon.code || !newCoupon.name) {
      setCreateModalError(t('coupons.admin.validation.requiredFields'));
      return;
    }

    try {
      setCreateModalError(null);
      
      const couponData: CreateCouponRequest = {
        ...newCoupon,
        originalLanguage: currentLanguage,
        // Note: autoTranslate handled separately if needed
      };

      await couponService.createCoupon(couponData);
      
      toast.success(t('coupons.admin.createSuccess'));
      setShowCreateModal(false);
      resetCreateForm();
      loadCoupons(page);
    } catch (err) {
      console.error('Failed to create coupon:', err);
      const errorMessage = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setCreateModalError(errorMessage ?? t('coupons.admin.errors.createFailed'));
    }
  };

  const resetCreateForm = () => {
    setNewCoupon({
      code: '',
      name: '',
      description: '',
      type: 'percentage',
      value: 0,
      minimumSpend: 0,
      maximumDiscount: 0,
      usageLimit: 100,
      usageLimitPerUser: 1,
      validFrom: new Date().toISOString().split('T')[0],
      validUntil: '',
      termsAndConditions: ''
    });
    setMultilingualCouponData({
      name: { th: '' },
      description: { th: '' },
      termsAndConditions: { th: '' }
    });
    setCurrentLanguage('th');
    setAvailableLanguages(['th']);
    setTranslationStatus({ 'th': 'original' });
    setCreateModalError(null);
  };

  const handleDeleteCoupon = async () => {
    if (!selectedCoupon || deleteConfirmText !== selectedCoupon.code) {
      return;
    }

    try {
      await couponService.deleteCoupon(selectedCoupon.id);
      toast.success(t('coupons.admin.deleteSuccess'));
      setShowDeleteModal(false);
      setSelectedCoupon(null);
      setDeleteConfirmText('');
      loadCoupons(page);
    } catch (err) {
      console.error('Failed to delete coupon:', err);
      toast.error(t('coupons.admin.errors.deleteFailed'));
    }
  };

  const openEditModal = (coupon: Coupon) => {
    setSelectedCoupon(coupon);
    
    // Initialize multilingual data for editing
    const originalLang = coupon.originalLanguage ?? 'th';
    setCurrentLanguage(originalLang);
    setAvailableLanguages(coupon.availableLanguages ?? [originalLang]);
    
    setMultilingualCouponData({
      name: { [originalLang]: coupon.name },
      description: { [originalLang]: coupon.description ?? '' },
      termsAndConditions: { [originalLang]: coupon.termsAndConditions ?? '' }
    });
    
    setNewCoupon({
      code: coupon.code,
      name: coupon.name,
      description: coupon.description ?? '',
      type: coupon.type,
      value: coupon.value ?? 0,
      minimumSpend: coupon.minimumSpend ?? 0,
      maximumDiscount: coupon.maximumDiscount ?? 0,
      usageLimit: coupon.usageLimit ?? 100,
      usageLimitPerUser: coupon.usageLimitPerUser,
      validFrom: coupon.validFrom ? new Date(coupon.validFrom).toISOString().split('T')[0] : '',
      validUntil: coupon.validUntil ? new Date(coupon.validUntil).toISOString().split('T')[0] : '',
      termsAndConditions: coupon.termsAndConditions ?? ''
    });
    
    // Load translations if available
    if (coupon.availableLanguages && coupon.availableLanguages.length > 1) {
      loadCouponTranslations(coupon.id, coupon.availableLanguages);
    }
    
    setShowCreateModal(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {t('coupons.admin.title')}
            </h1>
            <p className="mt-2 text-gray-600">
              {t('coupons.admin.description')}
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {t('coupons.admin.createCoupon')}
            </button>
            <DashboardButton />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Coupons List */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('coupons.admin.table.code')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('coupons.admin.table.name')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('coupons.admin.table.type')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('coupons.admin.table.value')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('coupons.admin.table.status')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('translation.languages')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {coupons.map((coupon) => (
                <tr key={coupon.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {coupon.code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {coupon.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {t(`coupons.types.${coupon.type}`)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {coupon.type === 'percentage' ? `${coupon.value}%` : 
                     coupon.type === 'fixed_amount' ? `${coupon.value} ${coupon.currency}` : 
                     t(`coupons.types.${coupon.type}`)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      coupon.status === 'active' ? 'bg-green-100 text-green-800' :
                      coupon.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                      coupon.status === 'paused' ? 'bg-gray-100 text-gray-800' :
                      'bg-red-100 text-red-800'
                    }`}
                    >
                      {t(`coupons.statuses.${coupon.status}`)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex space-x-1">
                      {(coupon.availableLanguages ?? ['th']).map(lang => (
                        <span
                          key={lang}
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                        >
                          {lang.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <button
                      onClick={() => openEditModal(coupon)}
                      className="text-primary-600 hover:text-primary-900"
                    >
                      {t('common.edit')}
                    </button>
                    {coupon.id && (
                      <button
                        onClick={() => handleTranslateCoupon(coupon.id, (['en', 'zh-CN'] as SupportedLanguage[]).filter(lang => !(coupon.availableLanguages ?? []).includes(lang)))}
                        disabled={translating}
                        className="text-green-600 hover:text-green-900 disabled:opacity-50"
                      >
                        {t('translation.translate')}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setSelectedCoupon(coupon);
                        setShowDeleteModal(true);
                      }}
                      className="text-red-600 hover:text-red-900"
                    >
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {coupons.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>{t('coupons.admin.noCoupons')}</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center space-x-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common.previous')}
            </button>
            <span className="px-3 py-2 text-gray-700">
              {t('common.pageOf', { current: page, total: totalPages })}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common.next')}
            </button>
          </div>
        )}
      </div>

      {/* Create/Edit Coupon Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {selectedCoupon ? t('coupons.admin.editCoupon') : t('coupons.admin.createCoupon')}
              </h3>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Language Tabs */}
              {selectedCoupon && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-medium text-gray-900">
                      {t('translation.languages')}
                    </h4>
                    <TranslationButton
                      onTranslate={(targetLanguages) => handleTranslateCoupon(selectedCoupon.id, targetLanguages)}
                      isTranslating={translating}
                      availableLanguages={availableLanguages}
                      originalLanguage={availableLanguages[0] ?? 'th'}
                    />
                  </div>
                  
                  <LanguageTabs
                    languages={availableLanguages}
                    currentLanguage={currentLanguage}
                    onLanguageChange={handleLanguageChange}
                    translationStatus={translationStatus}
                  />
                </div>
              )}

              {createModalError && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <p className="text-red-800">{createModalError}</p>
                </div>
              )}

              {/* Form Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('coupons.admin.form.code')} *
                  </label>
                  <input
                    type="text"
                    id="code"
                    value={newCoupon.code}
                    onChange={(e) => setNewCoupon({ ...newCoupon, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder={t('coupons.admin.form.codePlaceholder')}
                    disabled={!!selectedCoupon}
                  />
                </div>

                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('coupons.admin.form.name')} * ({currentLanguage.toUpperCase()})
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={newCoupon.name}
                    onChange={(e) => setNewCoupon({ ...newCoupon, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder={t('coupons.admin.form.namePlaceholder')}
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('coupons.admin.form.description')} ({currentLanguage.toUpperCase()})
                  </label>
                  <textarea
                    id="description"
                    value={newCoupon.description}
                    onChange={(e) => setNewCoupon({ ...newCoupon, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder={t('coupons.admin.form.descriptionPlaceholder')}
                  />
                </div>

                <div>
                  <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('coupons.admin.form.type')}
                  </label>
                  <select
                    id="type"
                    value={newCoupon.type}
                    onChange={(e) => setNewCoupon({ ...newCoupon, type: e.target.value as CouponType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="percentage">{t('coupons.types.percentage')}</option>
                    <option value="fixed_amount">{t('coupons.types.fixed_amount')}</option>
                    <option value="bogo">{t('coupons.types.bogo')}</option>
                    <option value="free_upgrade">{t('coupons.types.free_upgrade')}</option>
                    <option value="free_service">{t('coupons.types.free_service')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="value" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('coupons.admin.form.value')}
                  </label>
                  <input
                    type="number"
                    id="value"
                    value={newCoupon.value}
                    onChange={(e) => setNewCoupon({ ...newCoupon, value: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="termsAndConditions" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('coupons.admin.form.termsAndConditions')} ({currentLanguage.toUpperCase()})
                  </label>
                  <textarea
                    id="termsAndConditions"
                    value={newCoupon.termsAndConditions}
                    onChange={(e) => setNewCoupon({ ...newCoupon, termsAndConditions: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder={t('coupons.admin.form.termsPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setSelectedCoupon(null);
                  resetCreateForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateCoupon}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {selectedCoupon ? t('common.save') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedCoupon && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {t('coupons.admin.deleteCoupon')}
              </h3>
            </div>
            
            <div className="p-6">
              <p className="text-gray-700 mb-4">
                {t('coupons.admin.deleteConfirmation', { code: selectedCoupon.code })}
              </p>
              
              <div className="mb-4">
                <label htmlFor="confirmText" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('coupons.admin.typeCodeToConfirm')}
                </label>
                <input
                  type="text"
                  id="confirmText"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder={selectedCoupon.code}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedCoupon(null);
                  setDeleteConfirmText('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteCoupon}
                disabled={deleteConfirmText !== selectedCoupon.code}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignments Modal */}
      {showAssignmentsModal && selectedCoupon && (
        <CouponAssignmentsModal
          coupon={selectedCoupon}
          isOpen={showAssignmentsModal}
          onClose={() => {
            setShowAssignmentsModal(false);
            setSelectedCoupon(null);
          }}
        />
      )}
    </div>
  );
};

export default CouponManagementMultilingual;