import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import appleAuth from '@invertase/react-native-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WEB_URL = __DEV__ ? 'https://dev.forgather.app' : 'https://forgather.app';

const APPLE_FULL_NAME_STORAGE_KEY = 'appleFullName';

const formatFullName = (
  fullName: { givenName?: string | null; familyName?: string | null } | null,
) => {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.familyName].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};

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

  const postToWeb = (message: unknown) => {
    ref.current?.injectJavaScript(
      `window.postMessage(${JSON.stringify(JSON.stringify(message))}, '*'); true;`,
    );
  };

  const handleAppleLogin = async () => {
    if (!appleAuth.isSupported) {
      postToWeb({
        type: 'APPLE_TOKEN_ERROR',
        payload: { message: 'Apple 로그인을 지원하지 않는 기기입니다.' },
      });
      return;
    }

    try {
      const response = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      });

      const { identityToken, authorizationCode, nonce: rawNonce } = response;
      if (!identityToken || !authorizationCode || !rawNonce) {
        throw new Error('Apple 로그인 응답이 올바르지 않습니다.');
      }

      let fullName = formatFullName(response.fullName);
      if (fullName) {
        await AsyncStorage.setItem(APPLE_FULL_NAME_STORAGE_KEY, fullName);
      } else {
        fullName = await AsyncStorage.getItem(APPLE_FULL_NAME_STORAGE_KEY);
      }

      const payload: Record<string, string> = {
        id_token: identityToken,
        authorization_code: authorizationCode,
        raw_nonce: rawNonce,
      };
      if (fullName) {
        payload.full_name = fullName;
      }

      postToWeb({ type: 'APPLE_TOKEN', payload });
    } catch (e: any) {
      if (e?.code === appleAuth.Error.CANCELED) {
        return;
      }
      postToWeb({
        type: 'APPLE_TOKEN_ERROR',
        payload: { message: e?.message ?? 'Apple 로그인에 실패했습니다.' },
      });
    }
  };

  const onWebMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data?.type === 'APPLE_LOGIN') {
        handleAppleLogin();
      }
    } catch {}
  };

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
          onMessage={onWebMessage}
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
