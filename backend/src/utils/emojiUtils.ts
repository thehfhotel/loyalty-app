/**
 * Emoji Avatar Utility for Backend
 * Handles emoji validation and random assignment
 */

// Comprehensive list of person and animal emojis for profile pictures (same as frontend)
export const PROFILE_EMOJIS = [
  // Basic faces and people
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', 
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
  '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
  '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
  '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧',
  '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐',
  
  // People and professions
  '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓',
  '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🙇', '🤦',
  '🤷', '👮', '🕵️', '💂', '👷', '🤴', '👸', '👳', '👲', '🧕',
  '🤵', '👰', '🤰', '🤱', '👼', '🎅', '🤶', '🦸', '🦹', '🧙',
  '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '🙏',
  
  // People with activities and professions
  '🧑‍⚕️', '👨‍⚕️', '👩‍⚕️', '🧑‍🌾', '👨‍🌾', '👩‍🌾', '🧑‍🍳', '👨‍🍳', '👩‍🍳',
  '🧑‍🎓', '👨‍🎓', '👩‍🎓', '🧑‍🎤', '👨‍🎤', '👩‍🎤', '🧑‍🏫', '👨‍🏫', '👩‍🏫',
  '🧑‍🏭', '👨‍🏭', '👩‍🏭', '🧑‍💻', '👨‍💻', '👩‍💻', '🧑‍💼', '👨‍💼', '👩‍💼',
  '🧑‍🔧', '👨‍🔧', '👩‍🔧', '🧑‍🔬', '👨‍🔬', '👩‍🔬', '🧑‍🎨', '👨‍🎨', '👩‍🎨',
  '🧑‍🚒', '👨‍🚒', '👩‍🚒', '🧑‍✈️', '👨‍✈️', '👩‍✈️', '🧑‍🚀', '👨‍🚀', '👩‍🚀',
  '🧑‍⚖️', '👨‍⚖️', '👩‍⚖️', '🧑‍🦱', '👨‍🦱', '👩‍🦱', '🧑‍🦰', '👨‍🦰', '👩‍🦰',
  '🧑‍🦳', '👨‍🦳', '👩‍🦳', '🧑‍🦲', '👨‍🦲', '👩‍🦲',
  
  // Animals - mammals
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒',
  '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇',
  '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜',
  '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕',
  
  // Sea creatures
  '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳',
  '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦏', '🦛', '🐘', '🦒',
  '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐',
  '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🐓', '🦃', '🦚',
  '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦫',
  '🐿️', '🦔',
  
  // More animals and creatures
  '🐲', '🐉', '🦕', '🦖', '🐳', '🐋', '🐬', '🐟', '🐠', '🐡',
  '🦈', '🐙', '🦑', '🐚', '🦪', '🦀', '🦞', '🦐', '🐌', '🦋',
  '🐛', '🐜', '🐝', '🐞', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎'
];

/**
 * Get a random emoji for new user registration
 */
export function getRandomEmojiAvatar(): string {
  return PROFILE_EMOJIS[Math.floor(Math.random() * PROFILE_EMOJIS.length)];
}

/**
 * Check if a string is a valid emoji avatar
 */
export function isValidEmojiAvatar(emoji: string): boolean {
  return PROFILE_EMOJIS.includes(emoji);
}

/**
 * Generate avatar URL for emoji storage
 */
export function generateEmojiAvatarUrl(emoji: string): string {
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

/**
 * Validate and sanitize emoji avatar input
 */
export function validateEmojiAvatar(input: string): { isValid: boolean; emoji?: string; error?: string } {
  if (!input) {
    return { isValid: false, error: 'Emoji is required' };
  }

  if (!isValidEmojiAvatar(input)) {
    return { isValid: false, error: 'Invalid emoji selection' };
  }

  return { isValid: true, emoji: input };
}