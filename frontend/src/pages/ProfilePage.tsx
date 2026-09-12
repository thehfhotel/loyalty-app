import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { userService } from '../services/userService';
import { useAuthStore } from '../store/authStore';
import { notify } from '../utils/notificationManager';
import { logger } from '../utils/logger';
import { FiCopy, FiSettings, FiLogOut } from 'react-icons/fi';
import EmailDisplay from '../components/common/EmailDisplay';
import AppShell from '../components/layout/AppShell';
import { formatDateToDDMMYYYY } from '../utils/dateFormatter';
import SettingsModal from '../components/profile/SettingsModal';
import EmojiAvatar from '../components/profile/EmojiAvatar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import EmailVerificationModal from '../components/profile/EmailVerificationModal';
import MyDataSection from '../components/profile/MyDataSection';
import { Badge, Button, Card } from '../components/ui';

const profileSchema = z.object({
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  phone: z.string()
    .regex(/^[+\d\s()-]{6,}$/, 'Please enter a valid phone number')
    .optional()
    .or(z.literal('')),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  occupation: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

const ROLE_BADGE_TONE = {
  super_admin: 'gold',
  admin: 'brand',
} as const;

export default function ProfilePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const logout = useAuthStore((state) => state.logout);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // REST hooks
  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: () => userService.getProfile(),
  });
  const [emailMutationPending, setEmailMutationPending] = useState(false);

  const { reset } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  });

  // Handle URL parameters to open settings modal
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') {
      setShowSettingsModal(true);
      // Clean up URL parameter after opening modal
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Reset form when profile loads
  useEffect(() => {
    if (profile) {
      reset({
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone ?? '',
        dateOfBirth: profile.dateOfBirth
          ? new Date(profile.dateOfBirth).toISOString().split('T')[0]
          : '',
        gender: profile.gender ?? '',
        occupation: profile.occupation ?? '',
      });
    }
  }, [profile, reset]);

  const handleEmailVerificationNeeded = async (email: string) => {
    // Clear any previous email error
    setEmailError(null);
    setEmailMutationPending(true);

    try {
      // Call the REST API to initiate email change
      await userService.updateEmail(email);

      // Store the pending email and show verification modal
      setPendingEmail(email);
      setShowVerificationModal(true);
      setShowSettingsModal(false);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Set email error for red highlight in the modal
      setEmailError(errorMessage);
      notify.error(errorMessage ?? t('profile.emailChangeError', 'Failed to send verification code'));
      logger.error('Email verification initiation error:', error);
    } finally {
      setEmailMutationPending(false);
    }
  };

  const handleEmailVerified = (email: string) => {
    // Update the auth store with the verified email
    updateUser({ email, emailVerified: true });
    setShowVerificationModal(false);
    notify.success(t('profile.emailVerified'));
  };

  const onSubmit = async (data: ProfileFormData) => {
    setSavingProfile(true);
    try {
      // Convert empty strings to undefined (unlike ??, which passes "" through)
      const nonEmpty = (s?: string) => (s?.trim().length ? s : undefined);

      // Check if this is a profile completion (has new fields)
      const hasNewFields = nonEmpty(data.dateOfBirth)
        ?? nonEmpty(data.gender)
        ?? nonEmpty(data.occupation);

      if (hasNewFields) {
        // Use REST API for profile completion (Rust backend)
        const response = await userService.completeProfile({
          firstName: data.firstName,
          lastName: nonEmpty(data.lastName),
          phone: nonEmpty(data.phone),
          dateOfBirth: nonEmpty(data.dateOfBirth),
          gender: nonEmpty(data.gender),
          occupation: nonEmpty(data.occupation),
        });

        // Refetch profile to get updated data (ignore tRPC errors)
        await refetch().catch(() => {});

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
      } else {
        // Use REST API for regular profile update (Rust backend)
        await userService.updateProfile({
          firstName: data.firstName,
          lastName: nonEmpty(data.lastName),
          phone: nonEmpty(data.phone),
          dateOfBirth: nonEmpty(data.dateOfBirth),
        });

        // Refetch profile to get updated data (ignore tRPC errors)
        await refetch().catch(() => {});
        notify.success(t('profile.profileUpdated'));
      }

      setShowSettingsModal(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('profile.profileUpdateError');
      notify.error(message);
      logger.error('Profile update error:', error);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {return;}

    // Accept any image type - backend handles format conversion
    // This supports JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC, etc. from mobile and PC
    if (!file.type.startsWith('image/')) {
      notify.error(t('profile.invalidImageType'));
      return;
    }

    // Validate file size (15MB - backend will resize and compress)
    const maxSize = 15 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.error(t('profile.fileTooLarge'));
      return;
    }

    setUploadingAvatar(true);

    try {
      const response = await userService.uploadAvatar(file);

      // Refetch profile to get updated avatar
      await refetch();

      // Update auth store to persist avatar across restarts
      if (response.data?.avatarUrl) {
        updateUser({ avatarUrl: response.data.avatarUrl });
      }

      notify.success(t('profile.photoUpdated'));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      notify.error(errorMessage ?? t('profile.photoUploadError'));
      logger.error('Avatar upload error:', error);
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteAvatar = async () => {
    setUploadingAvatar(true);
    setShowDeleteConfirm(false);

    try {
      await userService.deleteAvatar();

      // Refetch profile to get updated data
      await refetch();

      // Update auth store to persist removal across restarts
      updateUser({ avatarUrl: undefined });

      notify.success(t('profile.photoRemoved'));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('profile.photoRemoveError');
      notify.error(msg);
      logger.error('Delete avatar error:', error);
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-brand-600" />
          <p className="mt-4 text-stone-600">{t('profile.loading')}</p>
        </div>
      </div>
    );
  }

  const isSaving = savingProfile || emailMutationPending;
  const roleBadgeTone = user?.role ? ROLE_BADGE_TONE[user.role as keyof typeof ROLE_BADGE_TONE] : undefined;

  return (
    <AppShell variant="guest" title={t('profile.title')} showProfileBanner={false}>
        {/* Profile Information Section */}
        <Card className="mb-6">
          {/* Profile Header with Settings Button */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-title text-ink">
              {t('profile.personalInformation')}
            </h2>
            <Button variant="primary" size="sm" onClick={() => setShowSettingsModal(true)}>
              <FiSettings className="h-4 w-4" aria-hidden="true" />
              {t('profile.editSettings')}
            </Button>
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
                <h3 className="text-body font-semibold text-ink" data-testid="profile-name">
                  {profile ? `${profile.firstName} ${profile.lastName}` : 'Loading...'}
                </h3>
                {user?.role && user.role !== 'customer' && (
                  <Badge tone={roleBadgeTone ?? 'neutral'}>
                    {user.role === 'super_admin' ? t('profile.superAdmin') :
                     user.role === 'admin' ? t('profile.admin') :
                     t('profile.staff')}
                  </Badge>
                )}
              </div>

              <dl className="divide-y divide-hairline">
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="flex items-center gap-2 text-caption text-ink-muted">
                    {t('profile.email')}
                    {user?.emailVerified === false && (
                      <button
                        onClick={() => {
                          setPendingEmail(user?.email ?? '');
                          setShowVerificationModal(true);
                        }}
                        className="rounded-lg bg-warning-50 px-2 py-0.5 text-fine text-warning-700 hover:bg-warning-50/70"
                        data-testid="verify-email-button"
                      >
                        {t('profile.verifyNow', 'ยืนยัน')}
                      </button>
                    )}
                  </dt>
                  <dd className="flex items-center gap-2 text-body text-ink" data-testid="profile-email">
                    <EmailDisplay
                      email={user?.email}
                      linkToProfile={true}
                      showIcon={false}
                    />
                    {user?.emailVerified === false && (
                      <span className="text-fine text-warning-700">
                        ({t('profile.notVerified', 'ยังไม่ยืนยัน')})
                      </span>
                    )}
                  </dd>
                </div>

                {profile?.phone && (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-caption text-ink-muted">{t('auth.phone')}</dt>
                    <dd className="text-body text-ink">{profile.phone}</dd>
                  </div>
                )}

                {profile?.dateOfBirth && (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-caption text-ink-muted">{t('profile.dateOfBirth')}</dt>
                    <dd className="text-body text-ink">
                      {formatDateToDDMMYYYY(profile.dateOfBirth)}
                    </dd>
                  </div>
                )}

                {profile?.gender && (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-caption text-ink-muted">{t('profile.gender')}</dt>
                    <dd className="text-body text-ink">
                      {profile.gender === 'male' ? t('profile.male') :
                       profile.gender === 'female' ? t('profile.female') :
                       profile.gender === 'other' ? t('profile.other') :
                       profile.gender === 'prefer_not_to_say' ? t('profile.preferNotToSay') :
                       profile.gender}
                    </dd>
                  </div>
                )}

                {profile?.occupation && (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-caption text-ink-muted">{t('profile.occupation')}</dt>
                    <dd className="text-body text-ink">{profile.occupation}</dd>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-caption text-ink-muted">{t('profile.memberSince')}</dt>
                  <dd className="text-body text-ink">
                    {profile ? formatDateToDDMMYYYY(profile.createdAt) : '...'}
                  </dd>
                </div>

                {profile?.membershipId && (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-caption text-ink-muted">{t('profile.membershipId')}</dt>
                    <dd className="flex items-center space-x-2">
                      <span className="rounded-lg bg-surface-sunken px-2 py-1 font-mono text-ink">
                        {profile.membershipId}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (profile.membershipId) {
                            navigator.clipboard.writeText(profile.membershipId);
                            notify.success(t('profile.membershipIdCopied'));
                          }
                        }}
                        title={t('profile.copyMembershipId')}
                        aria-label={t('profile.copyMembershipId')}
                      >
                        <FiCopy className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* Logout Section */}
          <div className="mt-6 pt-6 border-t border-hairline">
            <Button variant="destructive" onClick={logout} data-testid="logout-button">
              <FiLogOut className="h-4 w-4" aria-hidden="true" />
              {t('common.logout')}
            </Button>
          </div>
        </Card>

        {/* PDPA rights (F3). Below the profile card rather than inside it:
            these are legal requests with a 30-day clock, not settings. */}
        <MyDataSection />

        {/* Settings Modal */}
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => {
            setShowSettingsModal(false);
            setEmailError(null); // Clear email error when closing modal
          }}
          profile={profile ?? null}
          onSubmit={onSubmit}
          isSaving={isSaving}
          onAvatarUpload={handleAvatarUpload}
          onDeleteAvatar={async () => setShowDeleteConfirm(true)}
          uploadingAvatar={uploadingAvatar}
          onProfileUpdate={async () => {
            await refetch();
          }}
          onEmailVerificationNeeded={handleEmailVerificationNeeded}
          emailError={emailError}
        />

        {/* Email Verification Modal */}
        <EmailVerificationModal
          isOpen={showVerificationModal}
          onClose={() => setShowVerificationModal(false)}
          newEmail={pendingEmail}
          onVerified={handleEmailVerified}
          isRegistration={user?.emailVerified === false}
        />

        {/* Confirm Delete Avatar Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title={t('profile.confirmRemovePhoto')}
          message={t('profile.confirmRemovePhotoMessage', 'Are you sure you want to remove your profile photo? This action cannot be undone.')}
          confirmText={t('common.remove', 'Remove')}
          cancelText={t('common.cancel', 'Cancel')}
          onConfirm={handleDeleteAvatar}
          onCancel={() => setShowDeleteConfirm(false)}
          variant="danger"
        />
    </AppShell>
  );
}
