import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { userService, UserProfile } from '../services/userService';
import { useAuthStore } from '../store/authStore';
import { notify } from '../utils/notificationManager';
import { FiUser, FiPhone, FiCalendar, FiCamera, FiLink } from 'react-icons/fi';
import { getUserDisplayName, getOAuthProviderName, isOAuthUser } from '../utils/userHelpers';
import { useFeatureToggle, FEATURE_KEYS } from '../hooks/useFeatureToggle';
import DashboardButton from '../components/navigation/DashboardButton';

const profileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Check if account linking feature is enabled
  const isAccountLinkingEnabled = useFeatureToggle(FEATURE_KEYS.ACCOUNT_LINKING);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const profileData = await userService.getProfile();
      setProfile(profileData);
      reset({
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        phone: profileData.phone || '',
        dateOfBirth: profileData.dateOfBirth 
          ? new Date(profileData.dateOfBirth).toISOString().split('T')[0] 
          : '',
      });
    } catch (error: any) {
      notify.error(t('profile.profileLoadError'));
      console.error('Profile load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data: ProfileFormData) => {
    setIsSaving(true);
    try {
      const updatedProfile = await userService.updateProfile({
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
      });
      setProfile(updatedProfile);
      notify.success(t('profile.profileUpdated'));
    } catch (error: any) {
      notify.error(error.response?.data?.error || t('profile.profileUpdateError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      notify.error(t('profile.invalidImageType'));
      return;
    }

    // Validate file size (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.error(t('profile.fileTooLarge'));
      return;
    }

    setUploadingAvatar(true);

    try {
      const response = await userService.uploadAvatar(file);
      
      // Update local profile state immediately for instant display
      if (profile && response.data?.avatarUrl) {
        setProfile({
          ...profile,
          avatarUrl: response.data.avatarUrl
        });
        
        // Update auth store to persist avatar across restarts
        updateUser({ avatarUrl: response.data.avatarUrl });
      }
      
      notify.success(t('profile.photoUpdated'));
    } catch (error: any) {
      notify.error(error.response?.data?.error || t('profile.photoUploadError'));
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteAvatar = async () => {
    if (!confirm(t('profile.confirmRemovePhoto'))) {
      return;
    }

    setUploadingAvatar(true);
    try {
      await userService.deleteAvatar();
      
      // Update local profile state
      if (profile) {
        setProfile({
          ...profile,
          avatarUrl: undefined
        });
        
        // Update auth store to persist removal across restarts
        updateUser({ avatarUrl: undefined });
      }
      
      notify.success(t('profile.photoRemoved'));
    } catch (error: any) {
      notify.error(error.response?.data?.error || t('profile.photoRemoveError'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">{t('profile.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold text-gray-900">{t('profile.title')}</h1>
            </div>
            <div className="flex items-center space-x-4">
              <DashboardButton variant="outline" size="md" />
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500">
                  {t('profile.loggedInAs', { email: getUserDisplayName(user) })}
                  {isOAuthUser(user) && (
                    <span className="ml-1 text-xs text-gray-400">
                      {t('profile.via', { provider: getOAuthProviderName(user) })}
                    </span>
                  )}
                </span>
                {user?.role && user.role !== 'customer' && (
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    user.role === 'super_admin' 
                      ? 'bg-purple-100 text-purple-800' 
                      : user.role === 'admin'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {user.role === 'super_admin' ? t('profile.superAdmin') : 
                     user.role === 'admin' ? t('profile.admin') : 
                     t('profile.staff')}
                  </span>
                )}
              </div>
              <button
                onClick={logout}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                {t('common.logout')}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            {/* Profile Picture Section */}
            <div className="flex items-center mb-8">
              <div className="relative">
                <div className="h-20 w-20 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden">
                  {uploadingAvatar ? (
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  ) : profile?.avatarUrl ? (
                    <img
                      src={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000'}${profile.avatarUrl}?t=${Date.now()}`}
                      alt="Profile"
                      className="h-20 w-20 rounded-full object-cover"
                    />
                  ) : (
                    <FiUser className="h-8 w-8 text-gray-600" />
                  )}
                </div>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute bottom-0 right-0 bg-primary-600 text-white rounded-full p-1 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('profile.uploadPhotoTitle')}
                >
                  <FiCamera className="h-4 w-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              <div className="ml-6">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-medium text-gray-900">
                    {profile ? `${profile.firstName} ${profile.lastName}` : 'Loading...'}
                  </h3>
                  {user?.role && user.role !== 'customer' && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'super_admin' 
                        ? 'bg-purple-100 text-purple-800' 
                        : user.role === 'admin'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {user.role === 'super_admin' ? t('profile.superAdmin') : 
                       user.role === 'admin' ? t('profile.admin') : 
                       t('profile.staff')}
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2 mt-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="text-sm text-primary-600 hover:text-primary-700 disabled:opacity-50"
                  >
                    {profile?.avatarUrl ? t('profile.changePhoto') : t('profile.uploadPhoto')}
                  </button>
                  {profile?.avatarUrl && (
                    <button
                      onClick={handleDeleteAvatar}
                      disabled={uploadingAvatar}
                      className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      {t('profile.removePhoto')}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  {t('profile.memberSince')} {profile ? new Date(profile.createdAt).toLocaleDateString() : '...'}
                </p>
              </div>
            </div>

            {/* Profile Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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

              <div>
                <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
                  {t('profile.dateOfBirth')}
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiCalendar className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('dateOfBirth')}
                    id="dateOfBirth"
                    type="date"
                    className="appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>
                {errors.dateOfBirth && (
                  <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <Link
                  to="/dashboard"
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  {t('common.cancel')}
                </Link>
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

        {/* Account Linking Section - Only show if feature is enabled */}
        {isAccountLinkingEnabled && (
          <div className="mt-6 bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                {t('profile.accountLinking')}
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                {t('profile.accountLinkingDescription2')}
              </p>
              <Link
                to="/account-linking"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiLink className="mr-2 h-4 w-4" />
                {t('profile.manageAccountLinks')}
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}