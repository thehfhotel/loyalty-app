import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { userService, UserProfile } from '../services/userService';
import { useAuthStore } from '../store/authStore';
import { notify } from '../utils/notificationManager';
import { logger } from '../utils/logger';
import { FiCopy, FiSettings } from 'react-icons/fi';
import EmailDisplay from '../components/common/EmailDisplay';
import MainLayout from '../components/layout/MainLayout';
import { formatDateToDDMMYYYY } from '../utils/dateFormatter';
import { getTranslatedInterest } from '../utils/interestUtils';
import SettingsModal from '../components/profile/SettingsModal';
import EmojiAvatar from '../components/profile/EmojiAvatar';

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

export default function ProfilePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  const {
    register: _register,
    handleSubmit: _handleSubmit,
    formState: { errors: _errors },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle URL parameters to open settings modal
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') {
      setShowSettingsModal(true);
      // Clean up URL parameter after opening modal
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const loadProfile = async () => {
    try {
      const profileData = await userService.getProfile();
      setProfile(profileData);
      reset({
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        phone: profileData.phone ?? '',
        dateOfBirth: profileData.dateOfBirth
          ? new Date(profileData.dateOfBirth).toISOString().split('T')[0]
          : '',
        gender: profileData.gender ?? '',
        occupation: profileData.occupation ?? '',
        interests: Array.isArray(profileData.interests)
          ? profileData.interests.join(', ')
          : '',
      });
    } catch (error: unknown) {
      notify.error(t('profile.profileLoadError'));
      logger.error('Profile load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data: ProfileFormData) => {
    setIsSaving(true);
    try {
      // Check if this is a profile completion (has new fields)
      const hasNewFields = data.dateOfBirth ?? data.gender ?? data.occupation ?? data.interests;
      
      let response;
      if (hasNewFields) {
        // Use complete profile endpoint for potential coupon rewards
        response = await userService.completeProfile({
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone ?? undefined,
          dateOfBirth: data.dateOfBirth ?? undefined,
          gender: data.gender ?? undefined,
          occupation: data.occupation ?? undefined,
          interests: data.interests ? data.interests.split(',').map(i => i.trim()).filter(i => i) : undefined,
        });
        
        setProfile(response.profile);
        
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
            `🎉 Profile completed! You received: ${rewards.join(' and ')}`,
            { duration: 8000 }
          );
        } else {
          notify.success(t('profile.profileCompleted'));
        }
      } else {
        // Regular profile update
        const updatedProfile = await userService.updateProfile({
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone ?? undefined,
          dateOfBirth: data.dateOfBirth ?? undefined,
        });
        setProfile(updatedProfile);
        notify.success(t('profile.profileUpdated'));
      }
      
      // Update email if changed
      if (data.email && data.email !== user?.email) {
        await userService.updateEmail(data.email);
        updateUser({ email: data.email });
        notify.success(t('profile.emailUpdated'));
      }
      
      setShowSettingsModal(false);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error && 'response' in error 
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error 
        : undefined;
      notify.error(errorMessage ?? t('profile.profileUpdateError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {return;}

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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error && 'response' in error 
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error 
        : undefined;
      notify.error(errorMessage ?? t('profile.photoUploadError'));
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteAvatar = async () => {
    // eslint-disable-next-line no-alert -- User confirmation for destructive action
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error && 'response' in error 
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error 
        : undefined;
      notify.error(errorMessage ?? t('profile.photoRemoveError'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600" />
          <p className="mt-4 text-gray-600">{t('profile.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <MainLayout title={t('profile.title')} showProfileBanner={false} showDashboardButton={true}>
        {/* Profile Information Section */}
        <div className="mb-6 bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            {/* Profile Header with Settings Button */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-900">
                {t('profile.personalInformation')}
              </h2>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <FiSettings className="mr-2 h-4 w-4" />
                {t('profile.editSettings')}
              </button>
            </div>

            {/* Profile Display */}
            <div className="flex items-start space-x-6">
              <div className="flex-shrink-0">
                <EmojiAvatar 
                  avatarUrl={profile?.avatarUrl} 
                  size="xl"
                  onClick={() => setShowSettingsModal(true)}
                  className="cursor-pointer"
                />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-3 mb-4">
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
                    }`}
                    >
                      {user.role === 'super_admin' ? t('profile.superAdmin') : 
                       user.role === 'admin' ? t('profile.admin') : 
                       t('profile.staff')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="font-medium text-gray-500">{t('profile.email')}</dt>
                    <dd className="mt-1">
                      <EmailDisplay 
                        email={user?.email} 
                        linkToProfile={true}
                        showIcon={false}
                      />
                    </dd>
                  </div>
                  
                  {profile?.phone && (
                    <div>
                      <dt className="font-medium text-gray-500">{t('auth.phone')}</dt>
                      <dd className="mt-1 text-gray-900">{profile.phone}</dd>
                    </div>
                  )}
                  
                  {profile?.dateOfBirth && (
                    <div>
                      <dt className="font-medium text-gray-500">{t('profile.dateOfBirth')}</dt>
                      <dd className="mt-1 text-gray-900">
                        {formatDateToDDMMYYYY(profile.dateOfBirth)}
                      </dd>
                    </div>
                  )}

                  {profile?.gender && (
                    <div>
                      <dt className="font-medium text-gray-500">{t('profile.gender')}</dt>
                      <dd className="mt-1 text-gray-900">
                        {profile.gender === 'male' ? t('profile.male') :
                         profile.gender === 'female' ? t('profile.female') :
                         profile.gender === 'other' ? t('profile.other') :
                         profile.gender === 'prefer_not_to_say' ? t('profile.preferNotToSay') :
                         profile.gender}
                      </dd>
                    </div>
                  )}

                  {profile?.occupation && (
                    <div>
                      <dt className="font-medium text-gray-500">{t('profile.occupation')}</dt>
                      <dd className="mt-1 text-gray-900">{profile.occupation}</dd>
                    </div>
                  )}

                  {profile?.interests && profile.interests.length > 0 && (
                    <div>
                      <dt className="font-medium text-gray-500">{t('profile.interests')}</dt>
                      <dd className="mt-1">
                        <div className="flex flex-wrap gap-1">
                          {profile.interests.map((interest, index) => (
                            <span 
                              key={index}
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                            >
                              {getTranslatedInterest(interest, t)}
                            </span>
                          ))}
                        </div>
                      </dd>
                    </div>
                  )}

                  <div>
                    <dt className="font-medium text-gray-500">{t('profile.memberSince')}</dt>
                    <dd className="mt-1 text-gray-900">
                      {profile ? formatDateToDDMMYYYY(profile.createdAt) : '...'}
                    </dd>
                  </div>

                  {profile?.membershipId && (
                    <div>
                      <dt className="font-medium text-gray-500">{t('profile.membershipId')}</dt>
                      <dd className="mt-1 flex items-center space-x-2">
                        <span className="font-mono bg-gray-100 px-2 py-1 rounded text-gray-800">
                          {profile.membershipId}
                        </span>
                        <button
                          onClick={() => {
                            if (profile.membershipId) {
                              navigator.clipboard.writeText(profile.membershipId);
                              notify.success(t('profile.membershipIdCopied'));
                            }
                          }}
                          className="text-gray-400 hover:text-gray-600 p-1"
                          title={t('profile.copyMembershipId')}
                        >
                          <FiCopy className="h-3 w-3" />
                        </button>
                      </dd>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Settings Modal */}
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          profile={profile}
          onSubmit={onSubmit}
          isSaving={isSaving}
          onAvatarUpload={handleAvatarUpload}
          onDeleteAvatar={handleDeleteAvatar}
          uploadingAvatar={uploadingAvatar}
          onProfileUpdate={(updatedProfile) => {
            setProfile(updatedProfile);
            updateUser({ avatarUrl: updatedProfile.avatarUrl });
          }}
        />
    </MainLayout>
  );
}