const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web (wa-sqlite) build imports a .wasm binary; Metro must treat
// it as an asset to bundle the web target (spec header lists web; v1 DB is
// native-only per §12, but the bundle still needs to resolve cleanly).
config.resolver.assetExts.push('wasm');

module.exports = withNativeWind(config, { input: './global.css' });
