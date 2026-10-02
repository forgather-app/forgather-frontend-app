/**
 * @format
 */

import { AppRegistry } from 'react-native';
import * as Sentry from '@sentry/react-native';
import App from './App';
import { name as appName } from './app.json';
import { initSentry } from './monitoring';

initSentry();

AppRegistry.registerComponent(appName, () => Sentry.wrap(App));
