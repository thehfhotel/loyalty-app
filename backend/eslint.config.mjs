import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,

  // Global configuration
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
        ...globals.jest,
        NodeJS: 'readonly',
      },
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'security': security,
    },

    rules: {
      // TypeScript best practices - TYPE SAFETY CRITICAL
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-inferrable-types': 'warn',

      // Security plugin rules - UPGRADED TO ERRORS
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-object-injection': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',

      // Additional security best practices
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-console': 'warn',

      // Code quality rules
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-duplicate-imports': 'error',
      'no-constant-condition': 'error',

      // Prevent dangerous global access
      'no-restricted-globals': ['error', 'event', 'fdescribe'],

      // Prevent dangerous properties
      'no-restricted-properties': [
        'error',
        {
          object: 'global',
          property: 'eval',
          message: 'eval() is dangerous and should not be used.',
        },
        {
          object: 'window',
          property: 'eval',
          message: 'eval() is dangerous and should not be used.',
        },
      ],

      // Prevent dangerous imports
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['child_process'],
              message: 'Use carefully reviewed child_process operations only.',
            },
          ],
        },
      ],
    },
  },

  // Ignore patterns
  {
    ignores: [
      'dist/',
      'node_modules/',
      'src/generated/',
      '**/*.js',
    ],
  },

  // Test files - relaxed security rules
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'src/__tests__/**/*.ts'],
    rules: {
      'security/detect-object-injection': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    },
  },

  // Translation and language processing services
  {
    files: [
      'src/services/*translation*.ts',
      'src/services/*language*.ts',
      'src/utils/*translation*.ts',
    ],
    rules: {
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-fs-filename': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Image processing and file utilities
  {
    files: [
      'src/utils/*image*.ts',
      'src/utils/*file*.ts',
      'src/services/*storage*.ts',
    ],
    rules: {
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-fs-filename': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Survey processing services
  {
    files: [
      'src/services/*survey*.ts',
      'src/controllers/*survey*.ts',
    ],
    rules: {
      'security/detect-object-injection': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
