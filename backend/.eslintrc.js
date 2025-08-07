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
    // TypeScript best practices - adjusted for quality gate compatibility
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    '@typescript-eslint/prefer-optional-chain': 'warn',
    '@typescript-eslint/no-inferrable-types': 'warn',
    
    // Security plugin rules (enhanced configuration)
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'warn',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-new-buffer': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-non-literal-require': 'warn',
    'security/detect-object-injection': 'warn',
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
};