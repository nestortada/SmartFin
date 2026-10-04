/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { subscriptionHeadlessTask } from './src/modules/subscriptions/services/subscriptionRuntime';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask(
  'SmartFinSubscriptionMaintenance',
  () => subscriptionHeadlessTask,
);
