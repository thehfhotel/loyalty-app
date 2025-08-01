import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { userService, UserProfile } from '../services/userService';
import { useAuthStore } from '../store/authStore';
import { notify } from '../utils/notificationManager';
import { FiUser, FiPhone, FiCalendar, FiCamera, FiLink, FiCopy, FiSettings, FiGift } from 'react-icons/fi';
import EmailDisplay from '../components/common/EmailDisplay';
import { getUserDisplayName, getOAuthProviderName, isOAuthUser } from '../utils/userHelpers';
import DashboardButton from '../components/navigation/DashboardButton';
import { 
  loyaltyService, 
  UserLoyaltyStatus, 
  Tier, 
  PointsTransaction,
  PointsCalculation
} from '../services/loyaltyService';
import PointsBalance from '../components/loyalty/PointsBalance';
import TierStatus from '../components/loyalty/TierStatus';
import TransactionList from '../components/loyalty/TransactionList';
import SettingsModal from '../components/profile/SettingsModal';
import EmojiAvatar from '../components/profile/EmojiAvatar';

const profileSchema = z.object({
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
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
  
  // Loyalty data states
  const [loyaltyStatus, setLoyaltyStatus] = useState<UserLoyaltyStatus | null>(null);
  const [allTiers, setAllTiers] = useState<Tier[]>([]);
  const [pointsCalculation, setPointsCalculation] = useState<PointsCalculation | null>(null);
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  

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
    loadLoyaltyData();
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

  const loadLoyaltyData = async () => {
    try {
      setLoyaltyLoading(true);
      
      // Load all loyalty data in parallel
      const [statusResult, tiersResult, calculationResult, historyResult] = await Promise.all([
        loyaltyService.getUserLoyaltyStatus(),
        loyaltyService.getTiers(),
        loyaltyService.getPointsCalculation(),
        loyaltyService.getPointsHistory(10, 0)
      ]);

      setLoyaltyStatus(statusResult);
      setAllTiers(tiersResult);
      setPointsCalculation(calculationResult);
      setTransactions(historyResult.transactions);
    } catch (error) {
      console.error('Error loading loyalty data:', error);
      toast.error(t('errors.networkError'));
    } finally {
      setLoyaltyLoading(false);
    }
  };

  const onSubmit = async (data: ProfileFormData) => {
    setIsSaving(true);
    try {
      // Update profile
      const updatedProfile = await userService.updateProfile({
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
      });
      setProfile(updatedProfile);
      
      // Update email if changed
      if (data.email && data.email !== user?.email) {
        await userService.updateEmail(data.email);
        updateUser({ email: data.email });
        notify.success(t('profile.emailUpdated'));
      }
      
      notify.success(t('profile.profileUpdated'));
      setShowSettingsModal(false);
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

  if (isLoading || loyaltyLoading) {
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
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Membership Tier Display */}
        {loyaltyStatus && (
          <div className="mb-6 bg-white shadow rounded-lg border-l-4" style={{ borderLeftColor: loyaltyStatus.tier_color }}>
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="p-3 rounded-lg" style={{ backgroundColor: `${loyaltyStatus.tier_color}20` }}>
                    <FiGift className="w-8 h-8" style={{ color: loyaltyStatus.tier_color }} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      {loyaltyStatus.tier_name} {t('loyalty.member')}
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      {t('loyalty.currentTier')}
                      {loyaltyStatus.total_nights !== undefined && (
                        <> • {loyaltyStatus.total_nights} {loyaltyStatus.total_nights === 1 ? t('loyalty.night') : t('loyalty.nights')} {t('profile.stayed')}</>
                      )}
                      <> • {loyaltyStatus.current_points.toLocaleString()} {t('loyalty.availablePoints')}</>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="grid grid-cols-2 gap-4">
                    {loyaltyStatus.total_nights !== undefined && (
                      <div>
                        <div className="text-2xl font-bold" style={{ color: loyaltyStatus.tier_color }}>
                          {loyaltyStatus.total_nights}
                        </div>
                        <div className="text-sm text-gray-600">
                          {loyaltyStatus.total_nights === 1 ? t('loyalty.night') : t('loyalty.nights')}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {t('loyalty.tierEligibility')}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-2xl font-bold" style={{ color: loyaltyStatus.tier_color }}>
                        {loyaltyStatus.current_points.toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-600">
                        {t('loyalty.points')}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {t('loyalty.forRewards')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Progress to next tier */}
              {loyaltyStatus.next_tier_name && loyaltyStatus.progress_percentage !== null && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                    <span>
                      {t('loyalty.progressToNextTier', { tier: loyaltyStatus.next_tier_name })}
                    </span>
                    <span>
                      {loyaltyStatus.nights_to_next_tier !== undefined && loyaltyStatus.nights_to_next_tier !== null
                        ? `${loyaltyStatus.nights_to_next_tier} ${loyaltyStatus.nights_to_next_tier === 1 ? t('loyalty.nightToGo') : t('loyalty.nightsToGo')}`
                        : `${loyaltyStatus.points_to_next_tier?.toLocaleString()} ${t('loyalty.pointsToGo')}`
                      }
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${loyaltyStatus.progress_percentage}%`,
                        backgroundColor: loyaltyStatus.tier_color
                      }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
                    }`}>
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
                        {new Date(profile.dateOfBirth).toLocaleDateString()}
                      </dd>
                    </div>
                  )}

                  <div>
                    <dt className="font-medium text-gray-500">{t('profile.memberSince')}</dt>
                    <dd className="mt-1 text-gray-900">
                      {profile ? new Date(profile.createdAt).toLocaleDateString() : '...'}
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
                            navigator.clipboard.writeText(profile.membershipId!);
                            notify.success(t('profile.membershipIdCopied'));
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

        {/* Loyalty Information Section */}
        {loyaltyStatus && pointsCalculation && (
          <div className="mb-6">
            <div className="flex items-center space-x-2 mb-4">
              <FiGift className="h-6 w-6 text-primary-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t('loyalty.dashboard.title')}
              </h2>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Points & Transactions */}
              <div className="lg:col-span-2 space-y-6">
                {/* Points Balance */}
                <PointsBalance
                  loyaltyStatus={loyaltyStatus}
                />

                {/* Transaction History */}
                <TransactionList
                  transactions={transactions}
                  isLoading={false}
                />
              </div>

              {/* Right Column - Tier Status */}
              <div className="space-y-6">
                <TierStatus
                  loyaltyStatus={loyaltyStatus}
                  allTiers={allTiers}
                />
              </div>
            </div>
          </div>
        )}


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
      </main>
    </div>
  );
}