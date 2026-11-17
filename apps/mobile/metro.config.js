/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads this file as CommonJS. */
// Metro for an npm-workspaces monorepo. The website uses React 19.3.1 from the root node_modules;
// React Native 0.88 needs the exact React it was built for (19.3.0, installed in apps/mobile).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const sharedSource = path.join(workspaceRoot, 'packages', 'shared', 'src');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules'), path.join(workspaceRoot, 'node_modules')];

const pinned = ['react', 'react-dom', 'react-native'];
const fromMobile = path.join(projectRoot, 'package.json');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Every package (react-navigation, react-native itself…) gets the mobile copies of React.
  if (pinned.some(name => moduleName === name || moduleName.startsWith(`${name}/`))) {
    return context.resolveRequest({ ...context, originModulePath: fromMobile }, moduleName, platform);
  }
  // packages/shared is TypeScript written for Node ESM: `./courier.js` means `./courier.ts`.
  if (context.originModulePath.startsWith(sharedSource) && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
