/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand crimson, derived from the hotel logo (sampled #D4272E).
        // The action color sits at 600 so existing `bg-brand-600` /
        // `hover:bg-brand-700` call sites read correctly. The dark end of
        // the ramp converges onto the legacy HF One burgundy so dark
        // surfaces and pressed states keep the estate's deep tones —
        // see /Users/nut/HF/HF-erp/design/HF-ONE.md (crimson is a sanctioned
        // guest-app exception; primary action = brand-600).
        brand: {
          50: '#FDF1F1',
          100: '#FADCDD',
          200: '#F5B5B7',
          300: '#EC8388',
          400: '#E24E55',
          500: '#DB343C',
          600: '#D4272E', // primary action — 5.1:1 on white (AA)
          700: '#AF1F25', // hover
          800: '#8A1B1F', // pressed
          900: '#6B1212', // legacy HF burgundy (dark accents)
          950: '#4F0E0E', // legacy HF band burgundy
        },
        // HF One gold — tier "jewellery" only (Gold tier chips, highlights).
        gold: {
          50: '#FCF4E3',
          100: '#F6EACB',
          200: '#EEDBAA',
          300: '#E7C97F',
          400: '#DFB863',
          500: '#D9A441',
          600: '#B98730',
          700: '#93691F',
          800: '#6E4E17',
          900: '#4A340F',
        },
        // Warm surfaces (HF One: neutrals are warm, never slate/gray).
        surface: {
          page: '#FAF9F7',   // app background
          card: '#FFFFFF',   // cards, panels
          sunken: '#F4F1ED', // parchment wells, table headers
        },
        ink: {
          DEFAULT: '#26221E', // primary text (warm near-black)
          muted: '#7A7268',   // secondary text
          faint: '#A8A29E',   // placeholders, disabled
        },
        hairline: {
          DEFAULT: '#E8E4DF', // default borders
          strong: '#CFC9C1',  // inputs, dividers that must read
        },
        // Warm near-black tile surfaces — design accents (hero, member card).
        tile: {
          DEFAULT: '#211D1A',
          raised: '#2C2724',
          border: '#3A342F',
          text: '#F4F1ED',
          muted: '#A8A199',
        },
        success: { 50: '#EAF4EE', 600: '#2F855A', 700: '#276749' },
        warning: { 50: '#FBF3E4', 600: '#B7791F', 700: '#975A16' },
        error: { 50: '#FBEBEB', 600: '#C53030', 700: '#9B2C2C' },
        info: { 50: '#EBF1F7', 600: '#2C5282', 700: '#24436A' },
      },
      fontFamily: {
        sans: ['Sarabun', '"Noto Sans Thai"', 'system-ui', 'sans-serif'],
      },
      // Named type scale. Display sizes carry weight 600 and slight negative
      // tracking; body is 17px at 1.6 line-height (Thai vowel marks clip
      // below ~1.5, so Apple's 1.47 is deliberately relaxed here).
      fontSize: {
        fine: ['0.75rem', { lineHeight: '1.5' }],                                                     // 12
        caption: ['0.875rem', { lineHeight: '1.5' }],                                                 // 14
        body: ['1.0625rem', { lineHeight: '1.6' }],                                                   // 17
        title: ['1.375rem', { lineHeight: '1.45', letterSpacing: '-0.01em', fontWeight: '600' }],     // 22
        display: ['1.75rem', { lineHeight: '1.35', letterSpacing: '-0.015em', fontWeight: '600' }],   // 28
        'display-lg': ['2.125rem', { lineHeight: '1.3', letterSpacing: '-0.015em', fontWeight: '600' }], // 34
        'display-xl': ['2.5rem', { lineHeight: '1.3', letterSpacing: '-0.02em', fontWeight: '600' }], // 40
        hero: ['3.5rem', { lineHeight: '1.25', letterSpacing: '-0.02em', fontWeight: '600' }],        // 56
      },
      borderRadius: {
        card: '1.125rem', // 18px — cards. Utility radius = stock rounded-lg (8px); CTAs = rounded-full.
      },
      spacing: {
        5.5: '1.375rem', // 22px — pill button horizontal padding
      },
      maxWidth: {
        text: '61.25rem', // 980px — prose, forms
        page: '80rem',    // 1280px — guest grids, admin default
        wide: '90rem',    // 1440px — widest admin tables
      },
    },
    // Hard override (not extend): exactly two elevations exist. Legacy
    // shadow-sm/md/lg/xl classes become silent no-ops — the near-flat look
    // comes from hairline borders and surface-color changes instead.
    boxShadow: {
      none: 'none',
      soft: '0 12px 32px rgb(38 34 30 / 0.16)', // imagery-like elements only (QR member card)
      pop: '0 8px 24px rgb(38 34 30 / 0.14)',   // popovers / centered modals only
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
