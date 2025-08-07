module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: [
    '@typescript-eslint',
    'security',
  ],
  rules: {
    // TypeScript best practices - Phase 2: TYPE SAFETY CRITICAL
    '@typescript-eslint/no-explicit-any': 'error',           // ← UPGRADED from warn  
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',  // ← UPGRADED from warn
    '@typescript-eslint/prefer-optional-chain': 'error',     // ← UPGRADED from warn
    '@typescript-eslint/no-inferrable-types': 'warn',
    
    // Security plugin rules (Phase 1: UPGRADED TO ERRORS)
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'error',          // ← UPGRADED from warn
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-new-buffer': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'error', // ← UPGRADED from warn
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-non-literal-require': 'warn',
    'security/detect-object-injection': 'error',        // ← UPGRADED from warn
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-pseudoRandomBytes': 'error',
    'security/detect-unsafe-regex': 'error',
    
    // Additional security best practices
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-console': 'warn',
    
    // Code quality rules - critical errors
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
  env: {
    node: true,
    jest: true,
  },
  globals: {
    NodeJS: 'readonly',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'src/generated/',
    '*.js',
  ],
  overrides: [
    {
      // Test files - security rules relaxed for mock objects and test utilities
      files: ['**/*.test.ts', '**/*.spec.ts', 'src/__tests__/**/*.ts'],
      rules: {
        'security/detect-object-injection': 'warn', // Tests need flexible object access
        '@typescript-eslint/no-explicit-any': 'warn', // Mock objects often need any
        '@typescript-eslint/no-unused-vars': 'warn', // Test variables may be unused
        '@typescript-eslint/prefer-nullish-coalescing': 'warn', // Test flexibility
      },
    },
    {
      // Translation and language processing services
      files: ['src/services/*translation*.ts', 'src/services/*language*.ts', 'src/utils/*translation*.ts'],
      rules: {
        'security/detect-object-injection': 'warn', // Language processing needs dynamic object access
        'security/detect-non-literal-fs-filename': 'warn', // Translation cache and file operations
        '@typescript-eslint/no-explicit-any': 'warn', // Language processing may need flexible typing
      },
    },
    {
      // Image processing and file utilities
      files: ['src/utils/*image*.ts', 'src/utils/*file*.ts', 'src/services/*storage*.ts'],
      rules: {
        'security/detect-object-injection': 'warn', // Image metadata processing needs dynamic access
        'security/detect-non-literal-fs-filename': 'warn', // File operations with computed paths
        '@typescript-eslint/no-explicit-any': 'warn', // Image metadata may need flexible typing
      },
    },
    {
      // Survey processing services
      files: ['src/services/*survey*.ts', 'src/controllers/*survey*.ts'],
      rules: {
        'security/detect-object-injection': 'warn', // Survey response aggregation needs dynamic object access
        '@typescript-eslint/no-explicit-any': 'warn', // Survey data processing may need flexible typing
      },
    },
  ],
};