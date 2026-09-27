module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // SmartFin builds theme-dependent styles from the active palette at render time.
    'react-native/no-inline-styles': 'off',
    // A standalone void explicitly marks a deliberately unawaited async task.
    'no-void': ['warn', {allowAsStatement: true}],
    // The SMS hash uses `| 0` only to coerce its accumulator to a signed int32.
    'no-bitwise': ['warn', {int32Hint: true}],
  },
};
