import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

// const WEB_URL = __DEV__
//   ? 'https://dev.forgather.app/login'
//   : 'https://forgather.app';
const WEB_URL = 'https://dev.forgather.app';

const MY_DOMAINS = ['dev.forgather.app', 'forgather.app'];
const KAKAO_DOMAINS = ['kauth.kakao.com', 'accounts.kakao.com', 'kakao.com'];

const allowedHost = (host: string) =>
  [...MY_DOMAINS, ...KAKAO_DOMAINS].some(
    h => host === h || host.endsWith(`.${h}`),
  );

const App = () => {
  const ref = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && ref.current) {
        ref.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onShouldStart = (req: any) => {
    const url: string = req.url || '';

    if (url.startsWith('tel:') || url.startsWith('mailto:')) {
      Linking.openURL(url).catch(() => {});
      return false;
    }

    if (url.startsWith('kakaotalk://') || url.startsWith('kakao{')) {
      return false; // 외부 열기 금지
    }

    if (
      Platform.OS === 'ios' &&
      req.navigationType === 'click' &&
      !req.isTopFrame
    ) {
      ref.current?.injectJavaScript(
        `window.location.href=${JSON.stringify(url)}; true;`,
      );
      return false;
    }

    try {
      const host = url.split('/')[2]?.split(':')[0] || '';
      if (allowedHost(host)) {
        return true;
      }
    } catch {}

    Linking.openURL(url).catch(() => {});
    return false;
  };

  const injectedBefore = `
        (function() {
          window.open = function(url){ window.location.href = url; };
        })(); true;
      `;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <WebView
          ref={ref}
          source={{ uri: WEB_URL }}
          renderLoading={() => <ActivityIndicator size="large" />}
          domStorageEnabled
          javaScriptEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsInlineMediaPlayback
          startInLoadingState
          setSupportMultipleWindows={false}
          pullToRefreshEnabled={Platform.OS === 'android'}
          onNavigationStateChange={s => setCanGoBack(s.canGoBack)}
          onShouldStartLoadWithRequest={onShouldStart}
          onFileDownload={({ nativeEvent }) => {
            Linking.openURL(nativeEvent.downloadUrl);
          }}
          injectedJavaScriptBeforeContentLoaded={injectedBefore}
          userAgent={`ForgatherWebview/1.0 (iOS) WebView`}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

export default App;
