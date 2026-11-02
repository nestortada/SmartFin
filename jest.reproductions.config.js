// Phase 0 defect reproductions, kept apart from the stable suite (`npm test`).
// Each confirmed defect has a characterization test (current behavior, passes) and a `test.failing`
// acceptance test (expected behavior). The run stays green while the defects reproduce exactly and turns
// red when one changes: then the acceptance test is promoted to the stable suite as a regression test.
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/__tests__/reproductions/**/*.repro.ts', '**/__tests__/reproductions/**/*.repro.tsx'],
};
