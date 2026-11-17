// Local Android APK build. It needs the Android SDK and JDK 17+; without them it stops with a clear
// message instead of a long Gradle failure. Cloud alternative: `npm run build:android:eas -w @uzbite/mobile`
// (requires an Expo account).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) problems.push('ANDROID_HOME (or ANDROID_SDK_ROOT) is not set.');
else if (!existsSync(join(sdk, 'platform-tools')) || !existsSync(join(sdk, 'build-tools'))) problems.push(`Android SDK at ${sdk} has no platform-tools/build-tools. Install them with Android Studio's SDK Manager.`);

let javaMajor = 0;
const java = spawnSync('java', ['-version'], { encoding: 'utf8', shell: process.platform === 'win32' });
const version = /version "(\d+)(?:\.(\d+))?/.exec(`${java.stderr ?? ''}${java.stdout ?? ''}`);
if (version) javaMajor = Number(version[1]) === 1 ? Number(version[2]) : Number(version[1]);
if (!javaMajor) problems.push('Java was not found. Install JDK 17 and set JAVA_HOME.');
else if (javaMajor < 17) problems.push(`Java ${javaMajor} found; the Android build needs JDK 17 or newer (set JAVA_HOME to it).`);

const variant = process.env.APP_VARIANT ?? 'preview';
if (variant !== 'development' && !/^https:\/\//.test(process.env.EXPO_PUBLIC_API_URL ?? '')) problems.push(`APP_VARIANT=${variant} needs EXPO_PUBLIC_API_URL with a public https:// address (or set APP_VARIANT=development for a LAN test build).`);

if (problems.length) {
  console.error('Cannot build the Android APK on this computer:\n' + problems.map(item => `  - ${item}`).join('\n'));
  console.error('\nAlternative without a local SDK: EAS Build in the cloud (needs an Expo account):\n  npm run build:android:eas -w @uzbite/mobile');
  process.exit(1);
}

const env = { ...process.env, APP_VARIANT: variant };
execFileSync('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
execFileSync(gradle, ['assembleRelease'], { cwd: join(root, 'android'), stdio: 'inherit', env, shell: process.platform === 'win32' });
console.log(`APK: ${join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')}`);
