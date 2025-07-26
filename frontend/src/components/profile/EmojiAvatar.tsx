import React from 'react';
import { formatEmojiAvatar } from '../../utils/emojiUtils';

interface EmojiAvatarProps {
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

export default function EmojiAvatar({ 
  avatarUrl, 
  size = 'md', 
  className = '',
  onClick 
}: EmojiAvatarProps) {
  const { emoji, isEmoji, className: emojiClassName } = formatEmojiAvatar(avatarUrl, size);
  
  // Size configurations
  const sizeClasses = {
    sm: 'w-8 h-8 text-lg',
    md: 'w-12 h-12 text-2xl',
    lg: 'w-16 h-16 text-3xl',
    xl: 'w-20 h-20 text-4xl',
  };

  // Handle non-emoji avatars (uploaded images)
  if (!isEmoji && avatarUrl && !avatarUrl.startsWith('emoji:')) {
    return (
      <div
        className={`
          ${sizeClasses[size]} rounded-full bg-gray-100 border-2 border-gray-200 
          overflow-hidden flex items-center justify-center
          ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-500' : ''}
          ${className}
        `}
        onClick={onClick}
      >
        <img
          src={avatarUrl}
          alt="Profile"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  // Handle emoji avatars or default
  return (
    <div
      className={`
        ${sizeClasses[size]} rounded-full bg-gray-100 border-2 border-gray-200 
        flex items-center justify-center
        ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-500 hover:scale-105 transition-all' : ''}
        ${className}
      `}
      onClick={onClick}
      title={isEmoji ? `Profile picture: ${emoji}` : 'Click to set profile picture'}
    >
      <span className={emojiClassName}>
        {emoji}
      </span>
    </div>
  );
}

// Compact version for lists
export function EmojiAvatarCompact({ 
  avatarUrl, 
  className = '' 
}: Pick<EmojiAvatarProps, 'avatarUrl' | 'className'>) {
  return <EmojiAvatar avatarUrl={avatarUrl} size="sm" className={className} />;
}

// Large version for profile pages
export function EmojiAvatarLarge({ 
  avatarUrl, 
  onClick,
  className = '' 
}: Pick<EmojiAvatarProps, 'avatarUrl' | 'onClick' | 'className'>) {
  return (
    <EmojiAvatar 
      avatarUrl={avatarUrl} 
      size="xl" 
      onClick={onClick}
      className={className}
    />
  );
}