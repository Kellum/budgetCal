import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    // Property tests run thousands of cases.
    testTimeout: 60_000,
  },
});
