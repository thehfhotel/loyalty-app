/**
 * ESLint Best Practices Configuration
 * Migration from current warn-heavy setup to proper error enforcement
 */

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    '@typescript-eslint/recommended-requiring-type-checking',
  ],
  plugins: [
    '@typescript-eslint',
    'security',
  ],
  rules: {
    // =============================================================================
    // CRITICAL TYPE SAFETY - MUST BE ERRORS
    // =============================================================================
    '@typescript-eslint/no-explicit-any': 'error', // ← UPGRADED from warn
    '@typescript-eslint/no-unused-vars': 'error',  // ← UPGRADED from warn
    '@typescript-eslint/ban-types': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    
    // =============================================================================  
    // SECURITY RULES - ZERO TOLERANCE FOR VULNERABILITIES
    // =============================================================================
    'security/detect-object-injection': 'error',        // ← UPGRADED from warn
    'security/detect-non-literal-fs-filename': 'error', // ← UPGRADED from warn
    'security/detect-child-process': 'error',           // ← UPGRADED from warn  
    'security/detect-eval-with-expression': 'error',
    'security/detect-new-buffer': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    
    // =============================================================================
    // CODE QUALITY - PROGRESSIVE ENFORCEMENT 
    // =============================================================================
    '@typescript-eslint/prefer-nullish-coalescing': 'error', // ← UPGRADED from warn
    '@typescript-eslint/prefer-optional-chain': 'error',     // ← UPGRADED from warn
    '@typescript-eslint/no-inferrable-types': 'warn',        // ← Keep as warn (style)
    
    // =============================================================================
    // ENVIRONMENT-SPECIFIC RULES
    // =============================================================================
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn', // ← SMART UPGRADE
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-alert': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    
    // =============================================================================
    // SECURITY BEST PRACTICES - ALWAYS ERRORS
    // =============================================================================
    'no-eval': 'error',
    'no-implied-eval': 'error', 
    'no-new-func': 'error',
    'no-script-url': 'error',
    
    // =============================================================================
    // CODE CORRECTNESS - MUST BE ERRORS
    // =============================================================================
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-duplicate-imports': 'error',
    'no-constant-condition': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    
    // =============================================================================
    // RESTRICTED USAGE - SECURITY CRITICAL
    // =============================================================================
    'no-restricted-globals': ['error', 'event', 'fdescribe'],
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
  
  // =============================================================================
  // MIGRATION STRATEGY OVERRIDES
  // =============================================================================
  overrides: [
    {
      // Legacy code - gradual migration
      files: ['src/legacy/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn', // Allow gradual migration
      },
    },
    {
      // Test files - slightly relaxed
      files: ['**/*.test.ts', '**/*.spec.ts', 'src/__tests__/**/*.ts'],
      rules: {
        'security/detect-object-injection': 'warn', // Tests need flexible objects
        '@typescript-eslint/no-explicit-any': 'warn', // Mock objects often need any
      },
    },
    {
      // Generated files - skip entirely
      files: ['src/generated/**/*.ts'],
      rules: {},
    },
  ],
};