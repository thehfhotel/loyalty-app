interface User {
  id: string;
  email: string;
  role: 'customer' | 'admin' | 'super_admin';
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  oauthProvider?: string;
  oauthProviderId?: string;
}

/**
 * Gets a user-friendly display name from user data
 */
export function getUserDisplayName(user: User | null): string {
  if (!user) {return 'Guest';}

  // If we have first and last name, use them
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`;
  }

  // If we only have first name, use it
  if (user.firstName) {
    return user.firstName;
  }

  // If we only have last name, use it
  if (user.lastName) {
    return user.lastName;
  }

  // For OAuth users, try to extract name from email
  if (user.oauthProvider) {
    switch (user.oauthProvider) {
      case 'line':
        // For LINE users, show "LINE User" instead of the generated email
        return 'LINE User';
      case 'google':
        // For Google users, try to extract name from email before @
        const emailPart = user.email.split('@')[0];
        return emailPart.replace(/[._]/g, ' ');
      case 'facebook':
        // For Facebook users, similar logic
        const fbEmailPart = user.email.split('@')[0];
        return fbEmailPart.replace(/[._]/g, ' ');
      default:
        break;
    }
  }

  // Fallback to email username part
  const emailUsername = user.email.split('@')[0];
  return emailUsername.replace(/[._]/g, ' ');
}

/**
 * Gets a user avatar URL or returns null for default avatar
 */
export function getUserAvatarUrl(user: User | null): string | null {
  if (!user) {return null;}
  return user.avatarUrl || null;
}

/**
 * Checks if user is an OAuth user
 */
export function isOAuthUser(user: User | null): boolean {
  return !!(user?.oauthProvider);
}

/**
 * Gets the OAuth provider display name
 */
export function getOAuthProviderName(user: User | null): string | null {
  if (!user?.oauthProvider) {return null;}
  
  switch (user.oauthProvider) {
    case 'google':
      return 'Google';
    case 'facebook':
      return 'Facebook';
    case 'line':
      return 'LINE';
    default:
      return user.oauthProvider;
  }
}