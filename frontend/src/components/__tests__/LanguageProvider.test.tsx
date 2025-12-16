import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import LanguageProvider from '../LanguageProvider';

// Mock dependencies
const mockI18n = {
  language: 'en',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: mockI18n,
  }),
}));

describe('LanguageProvider', () => {
  const originalLang = document.documentElement.lang;
  const originalTitle = document.title;
  const originalBodyClassName = document.body.className;

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = '';
    document.title = '';
    document.body.className = '';
    mockI18n.language = 'en';
  });

  afterEach(() => {
    document.documentElement.lang = originalLang;
    document.title = originalTitle;
    document.body.className = originalBodyClassName;
  });

  describe('Basic Rendering', () => {
    it('should render children', () => {
      const { getByText } = render(
        <LanguageProvider>
          <div>Test Content</div>
        </LanguageProvider>
      );

      expect(getByText('Test Content')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      const { getByText } = render(
        <LanguageProvider>
          <div>First Child</div>
          <div>Second Child</div>
        </LanguageProvider>
      );

      expect(getByText('First Child')).toBeInTheDocument();
      expect(getByText('Second Child')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(container).toBeTruthy();
    });
  });

  describe('HTML Lang Attribute', () => {
    it('should set HTML lang attribute to English', () => {
      mockI18n.language = 'en';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('en');
    });

    it('should set HTML lang attribute to Thai', () => {
      mockI18n.language = 'th';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('th');
    });

    it('should set HTML lang attribute to Chinese', () => {
      mockI18n.language = 'zh-CN';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('zh-CN');
    });

    it('should update HTML lang attribute when language changes', () => {
      mockI18n.language = 'en';

      const { rerender } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('en');

      mockI18n.language = 'th';

      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('th');
    });
  });

  describe('Document Title', () => {
    it('should set English document title', () => {
      mockI18n.language = 'en';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.title).toBe('Hotel Loyalty App');
    });

    it('should set Thai document title', () => {
      mockI18n.language = 'th';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.title).toBe('แอปสะสมคะแนนโรงแรม');
    });

    it('should set Chinese document title', () => {
      mockI18n.language = 'zh-CN';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.title).toBe('酒店会员积分系统');
    });

    it('should fallback to English title for unknown language', () => {
      mockI18n.language = 'unknown';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.title).toBe('Hotel Loyalty App');
    });

    it('should update document title when language changes', () => {
      mockI18n.language = 'en';

      const { rerender } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.title).toBe('Hotel Loyalty App');

      mockI18n.language = 'th';

      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.title).toBe('แอปสะสมคะแนนโรงแรม');
    });
  });

  describe('Body Language Class', () => {
    it('should add English language class to body', () => {
      mockI18n.language = 'en';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('lang-en')).toBe(true);
    });

    it('should add Thai language class to body', () => {
      mockI18n.language = 'th';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('lang-th')).toBe(true);
    });

    it('should add Chinese language class to body', () => {
      mockI18n.language = 'zh-CN';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('lang-zh-CN')).toBe(true);
    });

    it('should remove previous language class when language changes', () => {
      mockI18n.language = 'en';

      const { rerender } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('lang-en')).toBe(true);

      mockI18n.language = 'th';

      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('lang-en')).toBe(false);
      expect(document.body.classList.contains('lang-th')).toBe(true);
    });

    it('should preserve other body classes when changing language', () => {
      document.body.className = 'existing-class another-class';
      mockI18n.language = 'en';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('existing-class')).toBe(true);
      expect(document.body.classList.contains('another-class')).toBe(true);
      expect(document.body.classList.contains('lang-en')).toBe(true);
    });

    it('should remove multiple previous language classes', () => {
      document.body.className = 'lang-en lang-th some-other-class';
      mockI18n.language = 'zh-CN';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.body.classList.contains('lang-en')).toBe(false);
      expect(document.body.classList.contains('lang-th')).toBe(false);
      expect(document.body.classList.contains('lang-zh-CN')).toBe(true);
      expect(document.body.classList.contains('some-other-class')).toBe(true);
    });
  });

  describe('Language Change Propagation', () => {
    it('should update all language-dependent properties together', () => {
      mockI18n.language = 'en';

      const { rerender } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('en');
      expect(document.title).toBe('Hotel Loyalty App');
      expect(document.body.classList.contains('lang-en')).toBe(true);

      mockI18n.language = 'th';

      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('th');
      expect(document.title).toBe('แอปสะสมคะแนนโรงแรม');
      expect(document.body.classList.contains('lang-th')).toBe(true);
    });

    it('should handle rapid language changes', () => {
      mockI18n.language = 'en';

      const { rerender } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      mockI18n.language = 'th';
      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      mockI18n.language = 'zh-CN';
      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      mockI18n.language = 'en';
      rerender(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('en');
      expect(document.title).toBe('Hotel Loyalty App');
      expect(document.body.classList.contains('lang-en')).toBe(true);
      expect(document.body.classList.contains('lang-th')).toBe(false);
      expect(document.body.classList.contains('lang-zh-CN')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty language gracefully', () => {
      mockI18n.language = '';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('');
      expect(document.title).toBe('Hotel Loyalty App');
      expect(document.body.classList.contains('lang-')).toBe(true);
    });

    it('should handle null children', () => {
      const { container } = render(<LanguageProvider>{null}</LanguageProvider>);

      expect(container).toBeTruthy();
    });

    it('should handle undefined children', () => {
      const { container } = render(<LanguageProvider>{undefined}</LanguageProvider>);

      expect(container).toBeTruthy();
    });

    it('should handle mixed content children', () => {
      const { getByText } = render(
        <LanguageProvider>
          <div>Text</div>
          {null}
          <span>More text</span>
          {undefined}
        </LanguageProvider>
      );

      expect(getByText('Text')).toBeInTheDocument();
      expect(getByText('More text')).toBeInTheDocument();
    });
  });

  describe('Component Lifecycle', () => {
    it('should set properties on mount', () => {
      mockI18n.language = 'th';

      render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('th');
      expect(document.title).toBe('แอปสะสมคะแนนโรงแรม');
      expect(document.body.classList.contains('lang-th')).toBe(true);
    });

    it('should update properties when rerendered with different language', () => {
      mockI18n.language = 'en';

      const { rerender } = render(
        <LanguageProvider>
          <div>Content</div>
        </LanguageProvider>
      );

      mockI18n.language = 'zh-CN';

      rerender(
        <LanguageProvider>
          <div>Updated Content</div>
        </LanguageProvider>
      );

      expect(document.documentElement.lang).toBe('zh-CN');
      expect(document.title).toBe('酒店会员积分系统');
      expect(document.body.classList.contains('lang-zh-CN')).toBe(true);
    });
  });
});
