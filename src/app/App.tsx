import React, { useEffect } from 'react';
import {
  AppState,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AppNavigator } from '../navigation/AppNavigator';
import { runSubscriptionMaintenance } from '../modules/subscriptions/services/subscriptionRuntime';

function App() {
  useEffect(() => {
    const maintain = () => {
      void runSubscriptionMaintenance().catch(() => undefined);
    };
    maintain();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') maintain();
    });
    return () => listener.remove();
  }, []);
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppNavigator />
        <Toast />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
