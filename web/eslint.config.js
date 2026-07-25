import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // dist/build are outputs; public/ holds generated WASM glue (wasm_exec.js,
  // sshclient.wasm.js) that is not hand-written source and isn't valid to lint.
  { ignores: ['dist', 'build', 'public'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Honour the codebase's `_`-prefix convention for deliberately unused
      // bindings (unused params kept for signature/positional reasons, caught
      // errors that are ignored on purpose).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `any` is used deliberately at a few external boundaries (the Go WASM
      // runtime, the generic event emitter, WebAuthn fields missing from lib
      // types). Surface these as warnings rather than failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
