import js from '@eslint/js'
import globals from 'globals'

export default [
  js.configs.recommended,

  {
    files: ['web/**/*.js', 'web/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-empty': 'off',
      'no-console': 'off',
      'no-irregular-whitespace': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-fallthrough': 'off',
      'no-self-assign': 'off',
      'no-cond-assign': 'off',
      'no-inner-declarations': 'off',
      'no-redeclare': 'off',
      'no-unreachable': 'warn',
      'no-mixed-spaces-and-tabs': 'warn',
      'no-trailing-spaces': 'warn',
      'no-multiple-empty-lines': ['warn', { max: 2 }],
      'prefer-const': 'off',
      'eqeqeq': 'off',
      'no-return-assign': 'off',
      'no-return-await': 'off',
      'no-async-promise-executor': 'off',
      'no-useless-catch': 'off',
      'no-extraneous-dependencies': 'off',
    },
  },

  {
    files: ['server/**/*.js', 'shared/**/*.js', 'electron/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-empty': 'off',
      'no-console': 'off',
      'no-irregular-whitespace': 'off',
      'no-prototype-builtins': 'off',
      'no-fallthrough': 'off',
      'no-unreachable': 'warn',
      'no-mixed-spaces-and-tabs': 'warn',
      'no-trailing-spaces': 'warn',
      'no-multiple-empty-lines': ['warn', { max: 2 }],
      'prefer-const': 'off',
      'eqeqeq': 'off',
    },
  },

  {
    files: ['test/**/*.js', 'test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-empty': 'off',
      'no-console': 'off',
      'no-unreachable': 'warn',
      'prefer-const': 'off',
      'eqeqeq': 'off',
    },
  },

  {
    files: ['blockbench-plugins/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        Blockbench: 'readonly',
        Texture: 'readonly',
        Project: 'readonly',
        Codecs: 'readonly',
        Dialog: 'readonly',
        Plugin: 'readonly',
        Action: 'readonly',
        MenuBar: 'readonly',
        prompt: 'readonly',
        btoa: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'off',
      'no-console': 'off',
      'no-undef': 'warn',
    },
  },

  {
    ignores: [
      'node_modules/**',
      'web/dist/**',
      'web/vendor/**',
      'dist/**',
      'dist-electron/**',
      'data/**',
      '.codeartsdoer/**',
      '.arts/**',
      '*.min.js',
    ],
  },
]