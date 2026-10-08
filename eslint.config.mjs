import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/cache/**',
            '**/state/**',
            '**/providers/**',
            '**/classifier/**',
            '**/scoring/**',
          ],
        },
      ],
    },
  },
);
