import { useState } from 'react';
import { getAllEmojiOptions, isValidEmojiAvatar, formatEmojiAvatar } from '../../utils/emojiUtils';

interface EmojiSelectorProps {
  currentEmoji?: string | null;
  onSelect: (emoji: string) => void;
  onCancel?: () => void;
  className?: string;
}

export default function EmojiSelector({ 
  currentEmoji, 
  onSelect, 
  onCancel,
  className = '' 
}: EmojiSelectorProps) {
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(currentEmoji ?? null);
  const emojiOptions = getAllEmojiOptions();

  const handleEmojiClick = (emoji: string) => {
    setSelectedEmoji(emoji);
  };

  const handleConfirm = () => {
    if (selectedEmoji) {
      onSelect(selectedEmoji);
    }
  };

  return (
    <div className={`bg-white rounded-lg border shadow-lg p-6 ${className}`}>
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Choose Your Profile Picture
        </h3>
        <p className="text-sm text-gray-600">
          Select an emoji to represent your profile
        </p>
      </div>

      {/* Current/Selected Preview */}
      <div className="flex justify-center mb-6">
        <div className="w-20 h-20 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
          {selectedEmoji ? (
            <span className="text-4xl">{selectedEmoji}</span>
          ) : (
            <span className="text-4xl text-gray-400">👤</span>
          )}
        </div>
      </div>

      {/* Emoji Options Grid */}
      <div className="max-h-64 overflow-y-auto mb-6 border rounded-lg p-3 bg-gray-50">
        <div className="grid grid-cols-8 gap-2">
          {emojiOptions.map((emoji, index) => (
            <button
              key={index}
              onClick={() => handleEmojiClick(emoji)}
              className={`
                w-8 h-8 rounded border flex items-center justify-center
                text-lg transition-all duration-200 hover:scale-110
                ${selectedEmoji === emoji 
                  ? 'border-blue-500 bg-blue-100 shadow-sm' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-white'
                }
              `}
              title={`Select ${emoji} as profile picture`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 
                     rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleConfirm}
          disabled={!selectedEmoji}
          className={`
            flex-1 px-4 py-2 rounded-lg font-medium transition-colors
            ${selectedEmoji
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          {selectedEmoji ? 'Confirm Selection' : 'Select an Emoji'}
        </button>
      </div>

      {/* Info Text */}
      <p className="text-xs text-gray-500 text-center mt-4">
        You can change your profile picture anytime in your profile settings
      </p>
    </div>
  );
}

// Compact version for inline use with all emojis in scrollable grid
export function EmojiSelectorInline({ 
  currentEmoji, 
  onSelect,
  className = '' 
}: Omit<EmojiSelectorProps, 'onCancel'>) {
  const emojiOptions = getAllEmojiOptions();

  return (
    <div className={`${className}`}>
      <div className="max-h-40 overflow-y-auto border rounded-lg p-2 bg-gray-50">
        <div className="grid grid-cols-8 gap-1">
          {emojiOptions.map((emoji, index) => (
            <button
              key={index}
              onClick={() => onSelect(emoji)}
              className={`
                w-7 h-7 rounded border flex items-center justify-center
                text-sm transition-all duration-200 hover:scale-110
                ${currentEmoji === emoji 
                  ? 'border-blue-500 bg-blue-100 shadow-sm' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-white'
                }
              `}
              title={`Select ${emoji} as profile picture`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}