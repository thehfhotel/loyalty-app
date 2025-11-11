import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmojiAvatar, { EmojiAvatarCompact, EmojiAvatarLarge } from '../EmojiAvatar';

describe('EmojiAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = render(<EmojiAvatar />);

      expect(container).toBeTruthy();
    });

    it('should render without crashing', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:🎉" />);

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should render with emoji avatar URL', () => {
      render(<EmojiAvatar avatarUrl="emoji:😀" />);

      expect(screen.getByText('😀')).toBeInTheDocument();
    });

    it('should have base styling classes', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('flex', 'items-center', 'justify-center', 'rounded-full');
    });
  });

  describe('Emoji Display', () => {
    it('should display emoji when provided in correct format', () => {
      render(<EmojiAvatar avatarUrl="emoji:😊" />);

      expect(screen.getByText('😊')).toBeInTheDocument();
    });

    it('should display different emojis correctly', () => {
      const { rerender } = render(<EmojiAvatar avatarUrl="emoji:😊" />);
      expect(screen.getByText('😊')).toBeInTheDocument();

      rerender(<EmojiAvatar avatarUrl="emoji:🐶" />);
      expect(screen.getByText('🐶')).toBeInTheDocument();
    });

    it('should display default icon when no avatar URL', () => {
      render(<EmojiAvatar />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should display default icon when avatar URL is null', () => {
      render(<EmojiAvatar avatarUrl={null} />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should display default icon when emoji is invalid', () => {
      render(<EmojiAvatar avatarUrl="emoji:🦄🦄🦄" />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should have emoji text sizing', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:🐱" />);

      const emojiSpan = screen.getByText('🐱');
      expect(emojiSpan).toHaveClass('select-none');
    });
  });

  describe('Image Display', () => {
    it('should display image when URL provided', () => {
      render(<EmojiAvatar avatarUrl="https://example.com/avatar.jpg" />);

      const img = screen.getByRole('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    });

    it('should use Profile as alt text for image', () => {
      render(<EmojiAvatar avatarUrl="https://example.com/avatar.jpg" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('alt', 'Profile');
    });

    it('should have cover styling for images', () => {
      render(<EmojiAvatar avatarUrl="https://example.com/avatar.jpg" />);

      const img = screen.getByRole('img');
      expect(img).toHaveClass('w-full', 'h-full', 'object-cover');
    });

    it('should prioritize image over emoji display', () => {
      render(<EmojiAvatar avatarUrl="https://example.com/avatar.jpg" />);

      expect(screen.getByRole('img')).toBeInTheDocument();
      expect(screen.queryByText('👤')).not.toBeInTheDocument();
    });

    it('should have overflow hidden for images', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="https://example.com/avatar.jpg" />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('overflow-hidden');
    });
  });

  describe('Size Variants', () => {
    it('should apply medium size by default', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-12', 'h-12');
    });

    it('should apply small size when specified', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" size="sm" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-8', 'h-8', 'text-lg');
    });

    it('should apply medium size when specified', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" size="md" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-12', 'h-12', 'text-2xl');
    });

    it('should apply large size when specified', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" size="lg" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-16', 'h-16', 'text-3xl');
    });

    it('should apply extra large size when specified', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" size="xl" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-20', 'h-20', 'text-4xl');
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😃" className="custom-class" />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('custom-class');
    });

    it('should maintain base classes with custom className', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😃" className="custom-class" />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('flex', 'items-center', 'justify-center', 'custom-class');
    });

    it('should apply multiple custom classes', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😃" className="class1 class2 class3" />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('class1', 'class2', 'class3');
    });
  });

  describe('Click Behavior', () => {
    it('should call onClick when clicked', async () => {
      const user = userEvent.setup();
      const mockOnClick = vi.fn();

      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😁" onClick={mockOnClick} />
      );

      const avatar = container.firstChild as HTMLElement;
      await user.click(avatar);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('should not add cursor-pointer when no onClick', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😁" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).not.toHaveClass('cursor-pointer');
    });

    it('should add cursor-pointer when onClick provided', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😁" onClick={() => {}} />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('cursor-pointer');
    });

    it('should add hover effects when onClick provided', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😁" onClick={() => {}} />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('hover:ring-2', 'hover:ring-blue-500');
    });

    it('should add scale transition when onClick provided', () => {
      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😁" onClick={() => {}} />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('hover:scale-105', 'transition-all');
    });

    it('should call onClick on multiple clicks', async () => {
      const user = userEvent.setup();
      const mockOnClick = vi.fn();

      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😁" onClick={mockOnClick} />
      );

      const avatar = container.firstChild as HTMLElement;
      await user.click(avatar);
      await user.click(avatar);
      await user.click(avatar);

      expect(mockOnClick).toHaveBeenCalledTimes(3);
    });
  });

  describe('Title Attribute', () => {
    it('should have title with emoji description when emoji avatar', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveAttribute('title', 'Profile picture: 😀');
    });

    it('should have title prompting to set picture when default', () => {
      const { container } = render(<EmojiAvatar />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveAttribute('title', 'Click to set profile picture');
    });
  });

  describe('Border Styling', () => {
    it('should have border styling', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('border-2', 'border-gray-200');
    });

    it('should have background color', () => {
      const { container } = render(<EmojiAvatar avatarUrl="emoji:😀" />);

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('bg-gray-100');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty avatar URL string', () => {
      const { container } = render(<EmojiAvatar avatarUrl="" />);

      expect(container.firstChild).toBeInTheDocument();
      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should handle special characters in emoji', () => {
      render(<EmojiAvatar avatarUrl="emoji:👨‍💻" />);

      expect(screen.getByText('👨‍💻')).toBeInTheDocument();
    });

    it('should handle invalid emoji format as image URL', () => {
      render(<EmojiAvatar avatarUrl="invalid:format" />);

      // Component treats this as image URL since it doesn't start with "emoji:"
      const img = screen.getByRole('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'invalid:format');
    });

    it('should handle emoji without prefix directly if in PROFILE_EMOJIS', () => {
      render(<EmojiAvatar avatarUrl="😀" />);

      // Component validates "😀" is in PROFILE_EMOJIS and renders it
      expect(screen.getByText('😀')).toBeInTheDocument();
    });

    it('should handle short invalid URL as image', () => {
      render(<EmojiAvatar avatarUrl="invalid" />);

      // Component treats this as image URL since it doesn't start with "emoji:"
      const img = screen.getByRole('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'invalid');
    });

    it('should handle data URL as image', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      render(<EmojiAvatar avatarUrl={dataUrl} />);

      const img = screen.getByRole('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', dataUrl);
    });
  });

  describe('Combined Props', () => {
    it('should combine size and onClick', async () => {
      const user = userEvent.setup();
      const mockOnClick = vi.fn();

      const { container } = render(
        <EmojiAvatar avatarUrl="emoji:😁" size="lg" onClick={mockOnClick} />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-16', 'h-16', 'cursor-pointer');

      await user.click(avatar);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('should combine size, className, and onClick', () => {
      const { container } = render(
        <EmojiAvatar
          avatarUrl="emoji:😁"
          size="sm"
          className="custom-class"
          onClick={() => {}}
        />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-8', 'h-8', 'custom-class', 'cursor-pointer');
    });

    it('should combine image URL with custom className', () => {
      const { container } = render(
        <EmojiAvatar
          avatarUrl="https://example.com/avatar.jpg"
          className="custom-class"
        />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('custom-class');

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    });

    it('should combine all props', async () => {
      const user = userEvent.setup();
      const mockOnClick = vi.fn();

      const { container } = render(
        <EmojiAvatar
          avatarUrl="emoji:🐨"
          size="xl"
          className="custom-class"
          onClick={mockOnClick}
        />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('w-20', 'h-20', 'custom-class', 'cursor-pointer');

      await user.click(avatar);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Image URL Hover Effects', () => {
    it('should have different hover effects for images with onClick', () => {
      const { container } = render(
        <EmojiAvatar
          avatarUrl="https://example.com/avatar.jpg"
          onClick={() => {}}
        />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).toHaveClass('hover:ring-2', 'hover:ring-blue-500');
    });

    it('should not have scale effect for images', () => {
      const { container } = render(
        <EmojiAvatar
          avatarUrl="https://example.com/avatar.jpg"
          onClick={() => {}}
        />
      );

      const avatar = container.firstChild as HTMLElement;
      expect(avatar).not.toHaveClass('hover:scale-105');
    });
  });
});

describe('EmojiAvatarCompact', () => {
  it('should render with small size', () => {
    const { container } = render(<EmojiAvatarCompact avatarUrl="emoji:😀" />);

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-8', 'h-8', 'text-lg');
  });

  it('should forward className prop', () => {
    const { container } = render(
      <EmojiAvatarCompact avatarUrl="emoji:😀" className="custom" />
    );

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('custom');
  });

  it('should support image URL', () => {
    render(<EmojiAvatarCompact avatarUrl="https://example.com/avatar.jpg" />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('should display default icon when no avatar URL', () => {
    render(<EmojiAvatarCompact />);

    expect(screen.getByText('👤')).toBeInTheDocument();
  });

  it('should always use small size', () => {
    const { container } = render(<EmojiAvatarCompact avatarUrl="emoji:😀" />);

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-8', 'h-8');
  });
});

describe('EmojiAvatarLarge', () => {
  it('should render with extra large size', () => {
    const { container } = render(<EmojiAvatarLarge avatarUrl="emoji:😀" />);

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-20', 'h-20', 'text-4xl');
  });

  it('should forward onClick prop', async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();

    const { container } = render(
      <EmojiAvatarLarge avatarUrl="emoji:😀" onClick={mockOnClick} />
    );

    const avatar = container.firstChild as HTMLElement;
    await user.click(avatar);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('should forward className prop', () => {
    const { container } = render(
      <EmojiAvatarLarge avatarUrl="emoji:😀" className="custom" />
    );

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('custom');
  });

  it('should support image URL', () => {
    render(<EmojiAvatarLarge avatarUrl="https://example.com/avatar.jpg" />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('should display default icon when no avatar URL', () => {
    render(<EmojiAvatarLarge />);

    expect(screen.getByText('👤')).toBeInTheDocument();
  });

  it('should always use extra large size', () => {
    const { container } = render(<EmojiAvatarLarge avatarUrl="emoji:😀" />);

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-20', 'h-20');
  });

  it('should combine all props', async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();

    const { container } = render(
      <EmojiAvatarLarge
        avatarUrl="emoji:🐨"
        onClick={mockOnClick}
        className="custom-class"
      />
    );

    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-20', 'h-20', 'custom-class', 'cursor-pointer');

    await user.click(avatar);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });
});
