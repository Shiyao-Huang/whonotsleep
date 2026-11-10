// iOS home-screen widget for WhoNotSleep (谁还没睡), built by @bacons/apple-targets.
// Re-run `npx expo prebuild -p ios --clean` after changing this file.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'WhoNotSleepWidget',
  displayName: '谁还没睡',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  icon: '../../assets/icon.png',
  colors: {
    $widgetBackground: '#0b0d1a',
    $accent: '#ffc35a',
    wnsBackground: '#0b0d1a',
    wnsAmber: '#ffc35a',
    wnsMoon: '#a9b8ff',
    wnsDim: '#8a8fb5',
  },
  entitlements: {
    // Same App Group as the main app: the app writes serverUrl/roomCode/memberId/token
    // through ExtensionStorage and the widget reads them via UserDefaults(suiteName:).
    'com.apple.security.application-groups': config.ios?.entitlements?.[
      'com.apple.security.application-groups'
    ] ?? ['group.com.copizza.whonotsleep'],
  },
});
