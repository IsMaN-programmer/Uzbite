import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Variants:
 * - development: Expo Go / dev client on the local Wi-Fi; plain HTTP to the computer's LAN IP is allowed.
 * - preview (internal APK) and production (store AAB): HTTPS/WSS only, never a LAN address.
 * The server address comes from EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SOCKET_URL at build time.
 */
const variant = (process.env.APP_VARIANT ?? 'development') as 'development' | 'preview' | 'production';
const development = variant === 'development';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
const socketUrl = process.env.EXPO_PUBLIC_SOCKET_URL ?? apiUrl;
const privateHost = /^(https?|wss?):\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
if (!development) {
  if (!/^https:\/\//.test(apiUrl) || privateHost.test(apiUrl)) throw new Error(`${variant} build: EXPO_PUBLIC_API_URL must be a public https:// address`);
  if (!/^(https|wss):\/\//.test(socketUrl) || privateHost.test(socketUrl)) throw new Error(`${variant} build: EXPO_PUBLIC_SOCKET_URL must be a public https:// or wss:// address`);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: development ? 'UzBite Courier Dev' : 'UzBite Courier',
  slug: 'uzbite-courier',
  scheme: 'uzbitecourier',
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  platforms: ['android', 'ios', 'web'],
  android: { package: development ? 'uz.uzbite.courier.dev' : 'uz.uzbite.courier', softwareKeyboardLayoutMode: 'resize' },
  ios: { bundleIdentifier: development ? 'uz.uzbite.courier.dev' : 'uz.uzbite.courier', supportsTablet: true },
  web: { bundler: 'metro' },
  plugins: [
    ['expo-build-properties', { android: { usesCleartextTraffic: development } }],
    // The face photo for courier admission is the only use of the camera and photo library.
    ['expo-image-picker', { cameraPermission: 'UzBite uses the camera to take your face photo for courier approval.', photosPermission: 'UzBite lets you choose a face photo for courier approval.', microphonePermission: false }],
    // Foreground location only: orders within 5 km while the app is open; no background tracking.
    ['expo-location', { locationWhenInUsePermission: 'UzBite uses your location while the app is open to show orders within 5 km.', isAndroidBackgroundLocationEnabled: false, isIosBackgroundLocationEnabled: false }],
  ],
  extra: { variant, allowCustomServer: development },
});
