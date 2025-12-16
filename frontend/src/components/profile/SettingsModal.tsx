import React, { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { FiX, FiUser, FiPhone, FiCamera, FiSmile, FiMail } from 'react-icons/fi';
import { UserProfile, userService } from '../../services/userService';
import { useAuthStore } from '../../store/authStore';
import EmojiAvatar from './EmojiAvatar';
import { EmojiSelectorInline } from './EmojiSelector';
import { notify } from '../../utils/notificationManager';
import { extractEmojiFromUrl } from '../../utils/emojiUtils';
import { GenderField, OccupationField, InterestsField, DateOfBirthField } from './ProfileFormFields';

const profileSchema = z.object({
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  occupation: z.string().optional(),
  interests: z.string().optional(), // Comma-separated string
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  onSubmit: (data: ProfileFormData) => Promise<void>;
  isSaving: boolean;
  onAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDeleteAvatar: () => Promise<void>;
  uploadingAvatar: boolean;
  onProfileUpdate?: (profile: UserProfile) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  profile,
  onSubmit,
  isSaving,
  onAvatarUpload,
  onDeleteAvatar,
  uploadingAvatar,
  onProfileUpdate
}: SettingsModalProps) {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmojiSelector, setShowEmojiSelector] = React.useState(false);
  const [updatingEmoji, setUpdatingEmoji] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      email: user?.email ?? '',
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
      phone: profile?.phone ?? '',
      dateOfBirth: profile?.dateOfBirth
        ? new Date(profile.dateOfBirth).toISOString().split('T')[0]
        : '',
      gender: profile?.gender ?? '',
      occupation: profile?.occupation ?? '',
      interests: profile?.interests?.join(', ') ?? '',
    }
  });

  // Watch the interests field to sync with InterestsField component
  const watchedInterests = watch('interests');

  // Reset form when profile or user changes
  React.useEffect(() => {
    if (profile) {
      reset({
        email: user?.email ?? '',
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone ?? '',
        dateOfBirth: profile.dateOfBirth 
          ? new Date(profile.dateOfBirth).toISOString().split('T')[0] 
          : '',
        gender: profile.gender ?? '',
        occupation: profile.occupation ?? '',
        interests: profile.interests?.join(', ') ?? '',
      });
    }
  }, [profile, user, reset]);

  const handleEmojiSelect = async (emoji: string) => {
    setUpdatingEmoji(true);
    try {
      const updatedProfile = await userService.updateEmojiAvatar(emoji);
      onProfileUpdate?.(updatedProfile);
      setShowEmojiSelector(false);
      notify.success('Profile picture updated!');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error && 'response' in error 
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error 
        : undefined;
      notify.error(errorMessage ?? 'Failed to update profile picture');
    } finally {
      setUpdatingEmoji(false);
    }
  };

  if (!isOpen) {return null;}

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-gray-900">
                {t('profile.editProfile')}
              </h3>
              <button
                onClick={onClose}
                className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <FiX className="h-6 w-6" />
              </button>
            </div>

            {/* Profile Picture Section */}
            <div className="mb-6">
              <h4 className="text-md font-medium text-gray-900 mb-4">Profile Picture</h4>
              
              <div className="flex items-center space-x-4 mb-4">
                <div className="relative">
                  <EmojiAvatar 
                    avatarUrl={profile?.avatarUrl} 
                    size="lg" 
                    className={updatingEmoji ? 'opacity-50' : ''}
                  />
                  {updatingEmoji && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1">
                  <div className="flex flex-wrap gap-2 mb-2">
                    <button
                      onClick={() => setShowEmojiSelector(!showEmojiSelector)}
                      disabled={updatingEmoji}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-primary-700 bg-primary-100 hover:bg-primary-200 disabled:opacity-50"
                    >
                      <FiSmile className="mr-1 h-4 w-4" />
                      Choose Emoji
                    </button>
                    
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar || updatingEmoji}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      <FiCamera className="mr-1 h-4 w-4" />
                      Upload Image
                    </button>
                    
                    {profile?.avatarUrl && (
                      <button
                        onClick={onDeleteAvatar}
                        disabled={uploadingAvatar || updatingEmoji}
                        className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50 px-2 py-1"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  
                  <p className="text-xs text-gray-500">
                    Choose an emoji or upload your own image for your profile picture
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onAvatarUpload}
                  className="hidden"
                />
              </div>

              {/* Emoji Selector */}
              {showEmojiSelector && (
                <div className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">Select an emoji:</span>
                    <button
                      onClick={() => setShowEmojiSelector(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <FiX className="h-4 w-4" />
                    </button>
                  </div>
                  <EmojiSelectorInline
                    currentEmoji={extractEmojiFromUrl(profile?.avatarUrl)}
                    onSelect={handleEmojiSelect}
                  />
                </div>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  {t('profile.email')}
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiMail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('email')}
                    id="email"
                    type="email"
                    className="appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    placeholder={t('profile.emailPlaceholder')}
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {t('profile.emailHelpText')}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                    {t('auth.firstName')}
                  </label>
                  <div className="mt-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiUser className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      {...register('firstName')}
                      id="firstName"
                      type="text"
                      className="appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder={t('profile.firstNamePlaceholder')}
                    />
                  </div>
                  {errors.firstName && (
                    <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                    {t('auth.lastName')}
                  </label>
                  <div className="mt-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiUser className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      {...register('lastName')}
                      id="lastName"
                      type="text"
                      className="appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder={t('profile.lastNamePlaceholder')}
                    />
                  </div>
                  {errors.lastName && (
                    <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                  {t('auth.phone')}
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiPhone className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('phone')}
                    id="phone"
                    type="tel"
                    className="appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    placeholder={t('profile.phonePlaceholder')}
                  />
                </div>
                {errors.phone && (
                  <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
                )}
              </div>

              <DateOfBirthField 
                register={register}
                errors={errors}
                isModal={false}
              />

              <GenderField 
                register={register}
                errors={errors}
                isModal={false}
              />

              <OccupationField 
                register={register}
                errors={errors}
                isModal={false}
              />

              <InterestsField
                register={register}
                errors={errors}
                isModal={false}
                watchedValue={watchedInterests}
              />

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}