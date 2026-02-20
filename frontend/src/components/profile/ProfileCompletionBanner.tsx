import { useState, useEffect, useCallback } from 'react';
import { FiX, FiGift, FiChevronRight, FiUser, FiPhone } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../../store/authStore';
import { notify } from '../../utils/notificationManager';
import { logger } from '../../utils/logger';
import { GenderField, OccupationField, DateOfBirthField } from './ProfileFormFields';
import { useQuery, useMutation } from '@tanstack/react-query';
import { userService } from '../../services/userService';

interface ProfileCompletionBannerProps {
  className?: string;
}

const profileCompletionSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  occupation: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

type ProfileCompletionFormData = z.infer<typeof profileCompletionSchema>;

export default function ProfileCompletionBanner({ className = '' }: ProfileCompletionBannerProps) {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const { data: profileStatus, isLoading, refetch } = useQuery({
    queryKey: ['user', 'profile-completion-status'],
    queryFn: () => userService.getProfileCompletionStatus(),
    enabled: !!user?.id,
    retry: false,
  });

  const completeProfileMutation = useMutation({
    mutationFn: (data: { firstName?: string; lastName?: string; phone?: string; dateOfBirth?: string; gender?: string; occupation?: string }) =>
      userService.completeProfile(data),
  });

  // Check if banner was previously dismissed in this session
  useEffect(() => {
    const wasDismissed = sessionStorage.getItem('profile-banner-dismissed');
    if (wasDismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ProfileCompletionFormData>({
    resolver: zodResolver(profileCompletionSchema),
  });

  const handleDismiss = () => {
    setIsDismissed(true);
    // Store dismissal in session storage (temporary dismissal)
    sessionStorage.setItem('profile-banner-dismissed', 'true');
  };

  const handleOpenModal = () => {
    setShowModal(true);
  };

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    reset();
  }, [reset]);

  // Handle keyboard events for modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showModal && !completeProfileMutation.isPending) {
        handleCloseModal();
      }
    };

    if (showModal) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [showModal, completeProfileMutation.isPending, handleCloseModal]);

  const onSubmit = async (data: ProfileCompletionFormData) => {
    try {
      const response = await completeProfileMutation.mutateAsync({
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? undefined,
        dateOfBirth: data.dateOfBirth ?? undefined,
        gender: data.gender ?? undefined,
        occupation: data.occupation ?? undefined,
      });

      // Show reward notifications
      const rewards = [];
      if (response.couponAwarded && response.coupon) {
        rewards.push(`coupon: ${response.coupon.name}`);
      }
      if (response.pointsAwarded && response.pointsAwarded > 0) {
        rewards.push(`${response.pointsAwarded.toLocaleString()} loyalty points`);
      }

      if (rewards.length > 0) {
        notify.success(
          `Profile completed! You received: ${rewards.join(' and ')}`,
          { duration: 8000 }
        );
      } else {
        notify.success(t('profile.profileCompleted'));
      }

      // Hide banner and modal
      setShowModal(false);
      setIsDismissed(true);
      sessionStorage.setItem('profile-banner-dismissed', 'true');

      // Refresh profile status
      await refetch();

    } catch (error: unknown) {
      notify.error((error instanceof Error ? error.message : null) ?? t('profile.profileUpdateError'));
      logger.error('Profile completion error:', error);
    }
  };

  const getMissingFieldsText = () => {
    if (!profileStatus?.missingFields || profileStatus.missingFields.length === 0) {
      return '';
    }

    const fields = profileStatus.missingFields.map(field => {
      switch (field) {
        case 'firstName': return t('auth.firstName');
        case 'lastName': return t('auth.lastName');
        case 'date_of_birth': return t('profile.dateOfBirth');
        case 'gender': return t('profile.gender');
        case 'occupation': return t('profile.occupation');
        case 'phone': return t('profile.phone');
        default: {
          // Fallback for unknown fields - capitalize and remove underscores
          const formattedField = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          logger.warn(`Missing translation for profile field: ${field}`);
          return formattedField;
        }
      }
    });
    
    if (fields.length === 0) {
      return '';
    } else if (fields.length === 1) {
      return fields[0];
    } else if (fields.length === 2) {
      return fields.join(` ${t('common.and')} `);
    } else {
      return `${fields.slice(0, -1).join(', ')} ${t('common.and')} ${fields[fields.length - 1]}`;
    }
  };

  // Don't show banner if loading, dismissed, profile is complete, or no coupon available
  if (isLoading || isDismissed || !profileStatus || profileStatus.isComplete || !profileStatus.newMemberCouponAvailable) {
    return null;
  }

  return (
    <div className={`bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center flex-1 min-w-0">
            <div className="flex-shrink-0">
              <FiGift className="h-6 w-6 text-yellow-300" />
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <p className="text-sm font-medium">
                <span className="inline-flex items-center">
                  <span className="bg-yellow-300 text-blue-900 px-2 py-0.5 rounded-full text-xs font-semibold mr-2">
                    {t('profile.newMemberOffer')}
                  </span>
                  {t('profile.completeProfileForCoupon')}
                </span>
              </p>
              <p className="text-xs text-blue-100 mt-1">
                {t('profile.missingFields', { fields: getMissingFieldsText() })}
              </p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <button
                onClick={handleOpenModal}
                className="inline-flex items-center px-4 py-2 border border-white/20 text-sm font-medium rounded-md text-white bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-blue-600 focus:ring-white transition-colors"
              >
                {t('profile.completeProfile')}
                <FiChevronRight className="ml-1 h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-shrink-0 ml-4">
            <button
              type="button"
              onClick={handleDismiss}
              className="inline-flex items-center justify-center p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-blue-600 focus:ring-white transition-colors"
              aria-label={t('common.dismiss')}
            >
              <FiX className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Profile Completion Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                      <FiGift className="h-6 w-6 text-blue-600" />
                    </div>
                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                      <h3 className="text-lg leading-6 font-medium text-gray-900">
                        {t('profile.completeProfile')}
                      </h3>
                      <p className="text-sm text-gray-500 mt-2">
                        {t('profile.completeProfileForCoupon')}
                      </p>
                      
                      <div className="mt-4 space-y-4">
                        {/* Only show fields that are actually missing */}
                        {profileStatus?.missingFields?.includes('firstName') && (
                          <div>
                            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                              <FiUser className="inline h-4 w-4 mr-2" />
                              {t('auth.firstName')} *
                            </label>
                            <input
                              type="text"
                              id="firstName"
                              {...register('firstName')}
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                              placeholder={t('profile.firstNamePlaceholder')}
                            />
                            {errors.firstName && (
                              <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                            )}
                          </div>
                        )}

                        {profileStatus?.missingFields?.includes('lastName') && (
                          <div>
                            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                              <FiUser className="inline h-4 w-4 mr-2" />
                              {t('auth.lastName')}
                            </label>
                            <input
                              type="text"
                              id="lastName"
                              {...register('lastName')}
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                              placeholder={t('profile.lastNamePlaceholder')}
                            />
                          </div>
                        )}

                        {profileStatus?.missingFields?.includes('date_of_birth') && (
                          <DateOfBirthField 
                            register={register}
                            errors={errors}
                            showRequiredAsterisk={true}
                            isModal={true}
                          />
                        )}

                        {profileStatus?.missingFields?.includes('gender') && (
                          <GenderField 
                            register={register}
                            errors={errors}
                            showRequiredAsterisk={true}
                            isModal={true}
                          />
                        )}

                        {profileStatus?.missingFields?.includes('occupation') && (
                          <OccupationField
                            register={register}
                            errors={errors}
                            showRequiredAsterisk={true}
                            isModal={true}
                          />
                        )}

                        {profileStatus?.missingFields?.includes('phone') && (
                          <div>
                            <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                              <FiPhone className="inline h-4 w-4 mr-2" />
                              {t('profile.phone')}
                            </label>
                            <input
                              type="tel"
                              id="phone"
                              {...register('phone')}
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                              placeholder={t('profile.phonePlaceholder')}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={completeProfileMutation.isPending}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {completeProfileMutation.isPending ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {t('common.saving')}
                      </>
                    ) : (
                      <>
                        <FiGift className="mr-2 h-4 w-4" />
                        {t('profile.completeProfile')}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    disabled={completeProfileMutation.isPending}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}