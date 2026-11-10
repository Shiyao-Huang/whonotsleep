import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App';

if (Platform.OS === 'android') {
  // Headless task that renders the Android home-screen widgets.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { widgetTaskHandler } = require('./src/widgets/android/widget-task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}

registerRootComponent(App);
