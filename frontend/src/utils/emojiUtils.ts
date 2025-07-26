/**
 * Emoji Avatar Utility
 * Handles emoji selection and random assignment for user avatars
 */

// Profile-related emoji options (business/professional focused)
export const PROFILE_EMOJIS = [
  // Professional/Business
  '🧑‍💼', '👩‍💼', '👨‍💼', '🧑‍🎓', '👩‍🎓', 
  '👨‍🎓', '🧑‍💻', '👩‍💻', '👨‍💻', '🧑‍🔬',
  '👩‍🔬', '👨‍🔬', '🧑‍⚕️', '👩‍⚕️', '👨‍⚕️',
  
  // Travel/Hotel themed
  '🧳', '✈️', '🏨', '🛎️', '🗝️', '🎫', '🌴', '🏖️', 
  '⭐', '🌟', '💎', '👑', '🏆', '🎖️', '🥇',
  
  // Friendly faces
  '😊', '😎', '🤗', '😇', '🥳', '😍', '🤩', '😋',
  '🙂', '😌', '😉', '🤓', '🧐', '🤔', '😁',
  
  // Activity/Lifestyle
  '🏃‍♂️', '🏃‍♀️', '🚴‍♂️', '🚴‍♀️', '🏊‍♂️', '🏊‍♀️',
  '🧘‍♂️', '🧘‍♀️', '🎯', '🎨', '📚', '🎵', '🎭',
  
  // Nature/Adventure
  '🌺', '🌸', '🌻', '🌷', '🦋', '🐝', '🌈', '☀️',
  '🌙', '⚡', '🔥', '💫', '🌊', '🍀', '🌿'
];

/**
 * Get 5 curated emoji options for user selection
 * Returns a mix of professional, travel, and friendly emojis
 */
export function getCuratedEmojiOptions(): string[] {
  const professional = ['🧑‍💼', '👩‍💼', '🧑‍🎓', '🧑‍💻', '⭐'];
  const travel = ['🧳', '✈️', '🏨', '🌴', '🏆'];
  const friendly = ['😊', '😎', '🤗', '🥳', '😍'];
  const lifestyle = ['🧘‍♀️', '🎯', '🎨', '🌺', '🦋'];
  const premium = ['💎', '👑', '🌟', '🔥', '💫'];
  
  // Randomly select one from each category
  const categories = [professional, travel, friendly, lifestyle, premium];
  return categories.map(category => 
    category[Math.floor(Math.random() * category.length)]
  );
}

/**
 * Get a random emoji from the full collection
 */
export function getRandomEmoji(): string {
  return PROFILE_EMOJIS[Math.floor(Math.random() * PROFILE_EMOJIS.length)];
}

/**
 * Check if a string is a valid emoji avatar
 */
export function isValidEmojiAvatar(emoji: string): boolean {
  return PROFILE_EMOJIS.includes(emoji);
}

/**
 * Format emoji avatar for display
 * Ensures consistent sizing and fallback
 */
export function formatEmojiAvatar(avatar: string | null | undefined, size: 'sm' | 'md' | 'lg' | 'xl' = 'md'): {
  emoji: string;
  isEmoji: boolean;
  className: string;
} {
  const isEmoji = avatar && PROFILE_EMOJIS.includes(avatar);
  
  const sizeClasses = {
    sm: 'text-lg', // ~18px
    md: 'text-2xl', // ~24px  
    lg: 'text-3xl', // ~30px
    xl: 'text-4xl', // ~36px
  };
  
  return {
    emoji: isEmoji ? avatar : '👤', // Default user icon
    isEmoji: !!isEmoji,
    className: `${sizeClasses[size]} select-none`,
  };
}

/**
 * Generate avatar URL for emoji (returns emoji directly for frontend use)
 * For consistency with existing avatar system
 */
export function generateEmojiAvatarUrl(emoji: string): string {
  // Return the emoji directly - frontend will handle display
  return `emoji:${emoji}`;
}

/**
 * Extract emoji from avatar URL
 */
export function extractEmojiFromUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  
  if (avatarUrl.startsWith('emoji:')) {
    const emoji = avatarUrl.replace('emoji:', '');
    return isValidEmojiAvatar(emoji) ? emoji : null;
  }
  
  return null;
}