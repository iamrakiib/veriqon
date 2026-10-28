import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['node_modules/**', 'dist/**', '**/.next/**'] }, ...tseslint.configs.recommended, {
  files: ['**/*.ts', '**/*.tsx'],
  rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
});
