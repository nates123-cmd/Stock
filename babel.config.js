module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo wires up Expo Router, the Reanimated/Worklets plugin,
    // and (when experiments.reactCompiler is set in app.json) React Compiler.
    // jsxImportSource: "nativewind" enables className -> style on RN elements.
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
