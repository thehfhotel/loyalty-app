/* eslint-disable @typescript-eslint/no-non-null-assertion, security/detect-unsafe-regex, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmojiSelector, { EmojiSelectorInline } from '../EmojiSelector';
import * as emojiUtils from '../../../utils/emojiUtils';

// Mock the emojiUtils module
vi.mock('../../../utils/emojiUtils', async () => {
  const actual = await vi.importActual<typeof emojiUtils>('../../../utils/emojiUtils');
  return {
    ...actual,
    getAllEmojiOptions: vi.fn(() => [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩'
    ])
  };
});

describe('EmojiSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(container).toBeTruthy();
    });

    it('should render without crashing', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should have title and description', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(screen.getByText('Choose Your Profile Picture')).toBeInTheDocument();
      expect(screen.getByText('Select an emoji to represent your profile')).toBeInTheDocument();
    });

    it('should have base styling classes', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelector onSelect={mockOnSelect} />);

      const selector = container.firstChild as HTMLElement;
      expect(selector).toHaveClass('bg-white', 'rounded-lg', 'border', 'shadow-lg', 'p-6');
    });

    it('should render info text at bottom', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(screen.getByText('You can change your profile picture anytime in your profile settings')).toBeInTheDocument();
    });
  });

  describe('Emoji Grid Rendering', () => {
    it('should render emoji grid', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButtons = screen.getAllByRole('button').filter(btn =>
        btn.textContent && /[\u{1F300}-\u{1F9FF}]/u.test(btn.textContent)
      );

      expect(emojiButtons.length).toBeGreaterThan(0);
    });

    it('should render all emoji options from getAllEmojiOptions', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(vi.mocked(emojiUtils.getAllEmojiOptions)).toHaveBeenCalled();

      // Verify emojis are rendered (excluding Cancel and Confirm buttons)
      const allButtons = screen.getAllByRole('button');
      const emojiButtons = allButtons.filter(btn =>
        btn.textContent && /[\u{1F300}-\u{1F9FF}]/u.test(btn.textContent)
      );

      expect(emojiButtons.length).toBe(16); // Mock returns 16 emojis
    });

    it('should render emojis in grid layout', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelector onSelect={mockOnSelect} />);

      const grid = container.querySelector('.grid');
      expect(grid).toBeInTheDocument();
      expect(grid).toHaveClass('grid-cols-8', 'gap-2');
    });

    it('should have scrollable container for emoji grid', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelector onSelect={mockOnSelect} />);

      const scrollContainer = container.querySelector('.max-h-64');
      expect(scrollContainer).toBeInTheDocument();
      expect(scrollContainer).toHaveClass('overflow-y-auto');
    });

    it('should render emoji buttons with proper styling', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveClass('w-8', 'h-8', 'rounded', 'border');
    });

    it('should have title attribute on emoji buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveAttribute('title', 'Select 😀 as profile picture');
    });
  });

  describe('Preview Display', () => {
    it('should show default icon when no emoji selected', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should show current emoji in preview when provided', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      // Preview should show the current emoji (using getAllByText since emoji appears in both preview and grid)
      const emojis = screen.getAllByText('😀');
      const preview = emojis.find(el => el.closest('.w-20'));
      expect(preview).toBeInTheDocument();
    });

    it('should show default icon when currentEmoji is null', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji={null} onSelect={mockOnSelect} />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should update preview when emoji is selected', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      // Click an emoji button
      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😊');
      expect(emojiButton).toBeTruthy();
      await user.click(emojiButton!);

      // Preview should now show the selected emoji (note: there might be two 😊 - one in grid, one in preview)
      const previewEmojis = screen.getAllByText('😊');
      expect(previewEmojis.length).toBeGreaterThanOrEqual(2);
    });

    it('should have preview container with proper styling', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      const preview = container.querySelector('.w-20.h-20.rounded-full');
      expect(preview).toBeInTheDocument();
      expect(preview).toHaveClass('bg-gray-100', 'border-2', 'border-gray-200');
    });
  });

  describe('Emoji Selection', () => {
    it('should call onSelect when emoji is selected and confirmed', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      // Select an emoji
      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(emojiButton!);

      // Click confirm button
      const confirmButton = screen.getByText('Confirm Selection');
      await user.click(confirmButton);

      expect(mockOnSelect).toHaveBeenCalledTimes(1);
      expect(mockOnSelect).toHaveBeenCalledWith('😀');
    });

    it('should not call onSelect when confirm is clicked without selection', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const confirmButton = screen.getByText('Select an Emoji');
      await user.click(confirmButton);

      expect(mockOnSelect).not.toHaveBeenCalled();
    });

    it('should allow changing emoji selection', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      // Select first emoji
      const firstEmoji = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(firstEmoji!);

      // Select second emoji
      const secondEmoji = screen.getAllByRole('button').find(btn => btn.textContent === '😊');
      await user.click(secondEmoji!);

      // Confirm
      const confirmButton = screen.getByText('Confirm Selection');
      await user.click(confirmButton);

      // Should call with the last selected emoji
      expect(mockOnSelect).toHaveBeenCalledWith('😊');
    });

    it('should update internal state when emoji is clicked', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(emojiButton!);

      // Confirm button text should change
      expect(screen.getByText('Confirm Selection')).toBeInTheDocument();
      expect(screen.queryByText('Select an Emoji')).not.toBeInTheDocument();
    });

    it('should initialize with currentEmoji when provided', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      // Confirm button should be enabled
      expect(screen.getByText('Confirm Selection')).toBeInTheDocument();
    });
  });

  describe('Current Emoji Highlighting', () => {
    it('should highlight the selected emoji', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(emojiButton!);

      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100', 'shadow-sm');
    });

    it('should highlight currentEmoji on initial render', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100', 'shadow-sm');
    });

    it('should remove highlight from previously selected emoji', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      const firstEmojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      expect(firstEmojiButton).toHaveClass('border-blue-500', 'bg-blue-100');

      // Select a different emoji
      const secondEmojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😊');
      await user.click(secondEmojiButton!);

      // First emoji should no longer be highlighted
      expect(firstEmojiButton).not.toHaveClass('border-blue-500', 'bg-blue-100');

      // Second emoji should be highlighted
      expect(secondEmojiButton).toHaveClass('border-blue-500', 'bg-blue-100');
    });

    it('should have default styling for non-selected emojis', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      const nonSelectedButton = screen.getAllByRole('button').find(btn => btn.textContent === '😊');
      expect(nonSelectedButton).toHaveClass('border-gray-200');
    });

    it('should have hover effects on emoji buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      expect(emojiButton).toHaveClass('hover:scale-110', 'transition-all', 'duration-200');
    });
  });

  describe('Action Buttons', () => {
    it('should render confirm button', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(screen.getByText('Select an Emoji')).toBeInTheDocument();
    });

    it('should disable confirm button when no emoji selected', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const confirmButton = screen.getByText('Select an Emoji');
      expect(confirmButton).toBeDisabled();
    });

    it('should enable confirm button when emoji is selected', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(emojiButton!);

      const confirmButton = screen.getByText('Confirm Selection');
      expect(confirmButton).not.toBeDisabled();
    });

    it('should render cancel button when onCancel is provided', () => {
      const mockOnSelect = vi.fn();
      const mockOnCancel = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} onCancel={mockOnCancel} />);

      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should not render cancel button when onCancel is not provided', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      const mockOnCancel = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} onCancel={mockOnCancel} />);

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('should have proper styling for enabled confirm button', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(emojiButton!);

      const confirmButton = screen.getByText('Confirm Selection');
      expect(confirmButton).toHaveClass('bg-blue-600', 'hover:bg-blue-700', 'text-white');
    });

    it('should have proper styling for disabled confirm button', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const confirmButton = screen.getByText('Select an Emoji');
      expect(confirmButton).toHaveClass('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
    });

    it('should have proper styling for cancel button', () => {
      const mockOnSelect = vi.fn();
      const mockOnCancel = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} onCancel={mockOnCancel} />);

      const cancelButton = screen.getByText('Cancel');
      expect(cancelButton).toHaveClass('text-gray-700', 'bg-gray-100', 'hover:bg-gray-200');
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(
        <EmojiSelector onSelect={mockOnSelect} className="custom-class" />
      );

      const selector = container.firstChild as HTMLElement;
      expect(selector).toHaveClass('custom-class');
    });

    it('should maintain base classes with custom className', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(
        <EmojiSelector onSelect={mockOnSelect} className="custom-class" />
      );

      const selector = container.firstChild as HTMLElement;
      expect(selector).toHaveClass('bg-white', 'rounded-lg', 'custom-class');
    });

    it('should apply multiple custom classes', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(
        <EmojiSelector onSelect={mockOnSelect} className="class1 class2 class3" />
      );

      const selector = container.firstChild as HTMLElement;
      expect(selector).toHaveClass('class1', 'class2', 'class3');
    });
  });

  describe('Keyboard Accessibility', () => {
    it('should allow keyboard navigation to emoji buttons', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      // Tab to first emoji button
      await user.tab();

      const allButtons = screen.getAllByRole('button');
      expect(allButtons.some(btn => btn === document.activeElement)).toBe(true);
    });

    it('should allow selecting emoji with Enter key', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      // Focus and click emoji button with keyboard
      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      emojiButton?.focus();
      await user.keyboard('{Enter}');

      // Should update preview
      expect(screen.getByText('Confirm Selection')).toBeInTheDocument();
    });

    it('should allow confirming selection with Enter key', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      // Select an emoji
      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      await user.click(emojiButton!);

      // Focus confirm button and press Enter
      const confirmButton = screen.getByText('Confirm Selection');
      confirmButton.focus();
      await user.keyboard('{Enter}');

      expect(mockOnSelect).toHaveBeenCalledWith('😀');
    });

    it('should allow canceling with Enter key', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      const mockOnCancel = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} onCancel={mockOnCancel} />);

      const cancelButton = screen.getByText('Cancel');
      cancelButton.focus();
      await user.keyboard('{Enter}');

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('should have all interactive elements as buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const allButtons = screen.getAllByRole('button');
      expect(allButtons.length).toBeGreaterThan(0);

      // All buttons should be focusable
      allButtons.forEach(button => {
        expect(button.tagName).toBe('BUTTON');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty emoji list gracefully', () => {
      vi.mocked(emojiUtils.getAllEmojiOptions).mockReturnValueOnce([]);

      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      expect(screen.getByText('Choose Your Profile Picture')).toBeInTheDocument();
    });

    it('should handle selecting same emoji multiple times', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');

      await user.click(emojiButton!);
      await user.click(emojiButton!);
      await user.click(emojiButton!);

      // Should still work normally
      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100');
    });

    it('should handle rapid emoji clicks', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelector onSelect={mockOnSelect} />);

      const buttons = screen.getAllByRole('button').filter(btn =>
        btn.textContent && /[\u{1F300}-\u{1F9FF}]/u.test(btn.textContent)
      );

      // Click multiple emojis rapidly
      await user.click(buttons[0]);
      await user.click(buttons[1]);
      await user.click(buttons[2]);

      // Last clicked should be selected
      expect(buttons[2]).toHaveClass('border-blue-500', 'bg-blue-100');
    });

    it('should handle undefined currentEmoji', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelector currentEmoji={undefined} onSelect={mockOnSelect} />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should maintain selection after multiple renders', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      const { rerender } = render(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100');

      rerender(<EmojiSelector currentEmoji="😀" onSelect={mockOnSelect} />);

      const updatedButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      expect(updatedButton).toHaveClass('border-blue-500', 'bg-blue-100');
    });
  });

  describe('Combined Props', () => {
    it('should combine all props correctly', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      const mockOnCancel = vi.fn();

      render(
        <EmojiSelector
          currentEmoji="😀"
          onSelect={mockOnSelect}
          onCancel={mockOnCancel}
          className="custom-class"
        />
      );

      // Should have custom class
      const container = screen.getByText('Choose Your Profile Picture').closest('.custom-class');
      expect(container).toBeInTheDocument();

      // Should highlight current emoji
      const emojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😀');
      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100');

      // Should have cancel button
      expect(screen.getByText('Cancel')).toBeInTheDocument();

      // Should be able to select and confirm
      const newEmojiButton = screen.getAllByRole('button').find(btn => btn.textContent === '😊');
      await user.click(newEmojiButton!);

      const confirmButton = screen.getByText('Confirm Selection');
      await user.click(confirmButton);

      expect(mockOnSelect).toHaveBeenCalledWith('😊');

      // Should be able to cancel
      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });
  });
});

describe('EmojiSelectorInline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      expect(container).toBeTruthy();
    });

    it('should render without crashing', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should render emoji grid', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButtons = screen.getAllByRole('button');
      expect(emojiButtons.length).toBe(16); // Mock returns 16 emojis
    });

    it('should have compact layout', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const scrollContainer = container.querySelector('.max-h-40');
      expect(scrollContainer).toBeInTheDocument();
    });
  });

  describe('Emoji Grid Rendering', () => {
    it('should render all emoji options from getAllEmojiOptions', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      expect(vi.mocked(emojiUtils.getAllEmojiOptions)).toHaveBeenCalled();

      const emojiButtons = screen.getAllByRole('button');
      expect(emojiButtons.length).toBe(16);
    });

    it('should render emojis in grid layout', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const grid = container.querySelector('.grid');
      expect(grid).toBeInTheDocument();
      expect(grid).toHaveClass('grid-cols-8', 'gap-1');
    });

    it('should have smaller buttons than full selector', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveClass('w-7', 'h-7', 'text-sm');
    });

    it('should have title attribute on emoji buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveAttribute('title', 'Select 😀 as profile picture');
    });
  });

  describe('Emoji Selection', () => {
    it('should call onSelect immediately when emoji is clicked', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      await user.click(emojiButton!);

      expect(mockOnSelect).toHaveBeenCalledTimes(1);
      expect(mockOnSelect).toHaveBeenCalledWith('😀');
    });

    it('should allow selecting multiple emojis in sequence', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const firstButton = screen.getByText('😀').closest('button');
      await user.click(firstButton!);

      const secondButton = screen.getByText('😊').closest('button');
      await user.click(secondButton!);

      expect(mockOnSelect).toHaveBeenCalledTimes(2);
      expect(mockOnSelect).toHaveBeenNthCalledWith(1, '😀');
      expect(mockOnSelect).toHaveBeenNthCalledWith(2, '😊');
    });

    it('should call onSelect with correct emoji for each click', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojis = ['😀', '😃', '😄', '😁'];

      for (const emoji of emojis) {
        const button = screen.getByText(emoji).closest('button');
        await user.click(button!);
      }

      expect(mockOnSelect).toHaveBeenCalledTimes(4);
      emojis.forEach((emoji, index) => {
        expect(mockOnSelect).toHaveBeenNthCalledWith(index + 1, emoji);
      });
    });
  });

  describe('Current Emoji Highlighting', () => {
    it('should highlight currentEmoji when provided', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline currentEmoji="😀" onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100', 'shadow-sm');
    });

    it('should not highlight any emoji when currentEmoji is null', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline currentEmoji={null} onSelect={mockOnSelect} />);

      const allButtons = screen.getAllByRole('button');
      allButtons.forEach(button => {
        expect(button).not.toHaveClass('border-blue-500', 'bg-blue-100');
      });
    });

    it('should not highlight any emoji when currentEmoji is undefined', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline currentEmoji={undefined} onSelect={mockOnSelect} />);

      const allButtons = screen.getAllByRole('button');
      allButtons.forEach(button => {
        expect(button).not.toHaveClass('border-blue-500', 'bg-blue-100');
      });
    });

    it('should have default styling for non-selected emojis', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline currentEmoji="😀" onSelect={mockOnSelect} />);

      const nonSelectedButton = screen.getByText('😊').closest('button');
      expect(nonSelectedButton).toHaveClass('border-gray-200');
    });

    it('should have hover effects on emoji buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveClass('hover:scale-110', 'transition-all', 'duration-200');
    });

    it('should update highlighting when currentEmoji prop changes', () => {
      const mockOnSelect = vi.fn();
      const { rerender } = render(
        <EmojiSelectorInline currentEmoji="😀" onSelect={mockOnSelect} />
      );

      let emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).toHaveClass('border-blue-500', 'bg-blue-100');

      rerender(<EmojiSelectorInline currentEmoji="😊" onSelect={mockOnSelect} />);

      emojiButton = screen.getByText('😀').closest('button');
      expect(emojiButton).not.toHaveClass('border-blue-500', 'bg-blue-100');

      const newButton = screen.getByText('😊').closest('button');
      expect(newButton).toHaveClass('border-blue-500', 'bg-blue-100');
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(
        <EmojiSelectorInline onSelect={mockOnSelect} className="custom-class" />
      );

      const selector = container.firstChild as HTMLElement;
      expect(selector).toHaveClass('custom-class');
    });

    it('should apply multiple custom classes', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(
        <EmojiSelectorInline onSelect={mockOnSelect} className="class1 class2" />
      );

      const selector = container.firstChild as HTMLElement;
      expect(selector).toHaveClass('class1', 'class2');
    });
  });

  describe('Keyboard Accessibility', () => {
    it('should allow keyboard navigation to emoji buttons', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      await user.tab();

      const allButtons = screen.getAllByRole('button');
      expect(allButtons.some(btn => btn === document.activeElement)).toBe(true);
    });

    it('should allow selecting emoji with Enter key', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      emojiButton?.focus();
      await user.keyboard('{Enter}');

      expect(mockOnSelect).toHaveBeenCalledWith('😀');
    });

    it('should allow selecting emoji with Space key', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const emojiButton = screen.getByText('😀').closest('button');
      emojiButton?.focus();
      await user.keyboard(' ');

      expect(mockOnSelect).toHaveBeenCalledWith('😀');
    });

    it('should have all interactive elements as buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const allButtons = screen.getAllByRole('button');

      allButtons.forEach(button => {
        expect(button.tagName).toBe('BUTTON');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty emoji list gracefully', () => {
      vi.mocked(emojiUtils.getAllEmojiOptions).mockReturnValueOnce([]);

      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should handle rapid clicks', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const button = screen.getByText('😀').closest('button');

      await user.click(button!);
      await user.click(button!);
      await user.click(button!);

      expect(mockOnSelect).toHaveBeenCalledTimes(3);
    });

    it('should handle special character emojis', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();

      vi.mocked(emojiUtils.getAllEmojiOptions).mockReturnValueOnce(['👨‍💻', '👩‍🎓']);

      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const button = screen.getAllByRole('button')[0];
      await user.click(button);

      expect(mockOnSelect).toHaveBeenCalled();
    });
  });

  describe('Compact Layout Differences', () => {
    it('should have smaller max height than full selector', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const scrollContainer = container.querySelector('.max-h-40');
      expect(scrollContainer).toBeInTheDocument();
    });

    it('should have tighter gap between buttons', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const grid = container.querySelector('.grid');
      expect(grid).toHaveClass('gap-1');
    });

    it('should not have title or description text', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      expect(screen.queryByText('Choose Your Profile Picture')).not.toBeInTheDocument();
      expect(screen.queryByText('Select an emoji to represent your profile')).not.toBeInTheDocument();
    });

    it('should not have action buttons', () => {
      const mockOnSelect = vi.fn();
      render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      expect(screen.queryByText('Confirm Selection')).not.toBeInTheDocument();
      expect(screen.queryByText('Select an Emoji')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('should not have preview section', () => {
      const mockOnSelect = vi.fn();
      const { container } = render(<EmojiSelectorInline onSelect={mockOnSelect} />);

      const preview = container.querySelector('.w-20.h-20.rounded-full');
      expect(preview).not.toBeInTheDocument();
    });
  });

  describe('Combined Props', () => {
    it('should combine all props correctly', async () => {
      const user = userEvent.setup();
      const mockOnSelect = vi.fn();

      render(
        <EmojiSelectorInline
          currentEmoji="😀"
          onSelect={mockOnSelect}
          className="custom-class"
        />
      );

      const container = screen.getByText('😀').closest('.custom-class');
      expect(container).toBeInTheDocument();

      const highlightedButton = screen.getByText('😀').closest('button');
      expect(highlightedButton).toHaveClass('border-blue-500', 'bg-blue-100');

      const otherButton = screen.getByText('😊').closest('button');
      await user.click(otherButton!);

      expect(mockOnSelect).toHaveBeenCalledWith('😊');
    });
  });
});
