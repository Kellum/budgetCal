import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// The engine and model must be deterministic and portable: no clocks, no locale,
// no randomness, no Date parsing (new Date('2026-10-15') is midnight UTC, which is
// the 14th across the US). Dates are integer civil days; see docs/PLAN.md §4.1.
const deterministic = {
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'Use CivilDate from engine/date. Dates carry no time or timezone.' },
    { name: 'Intl', message: 'Formatting belongs in the UI, not the engine or model.' },
    { name: 'performance', message: 'The engine never reads a clock.' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'The engine must be deterministic.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/reports/**', '**/.stryker-tmp/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      ...deterministic,
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^(?!\\.)', message: 'The engine has zero dependencies. Config arrives as data.' }] },
      ],
    },
  },
  {
    files: ['packages/model/src/**/*.ts'],
    rules: deterministic,
  },
);
