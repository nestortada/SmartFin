module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Keeps versioned evidence under docs/ intact; see the file for SMARTFIN_WRITE_EVIDENCE.
  setupFiles: ['<rootDir>/__tests__/setup/redirectEvidenceWrites.js'],
};
