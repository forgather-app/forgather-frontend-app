import { login } from '@react-native-seoul/kakao-login';
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

// const WEB_URL = __DEV__
//   ? 'https://dev.forgather.app/login'
//   : 'https://forgather.app';
const WEB_URL = 'https://dev.forgather.app';

const APPLE_FULL_NAME_STORAGE_KEY = 'appleFullName';

const formatFullName = (
  fullName: { givenName?: string | null; familyName?: string | null } | null,
) => {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.familyName].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};

const MY_DOMAINS = ['dev.forgather.app', 'forgather.app', 'localhost'];
const KAKAO_DOMAINS = ['kauth.kakao.com', 'accounts.kakao.com', 'kakao.com'];

const allowedHost = (host: string) =>
  [...MY_DOMAINS, ...KAKAO_DOMAINS].some(
    h => host === h || host.endsWith(`.${h}`),
  );

const App = () => {
  const ref = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const kakaoLoginInFlight = useRef(false);

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

  const onMessage = async (event: WebViewMessageEvent) => {
    console.error('[KakaoLogin] RAW onMessage:', event.nativeEvent.data);
    try {
      const { type } = JSON.parse(event.nativeEvent.data);
      console.error('[KakaoLogin] parsed type:', type);
      if (type === 'NET_LOG') {
        const { payload } = JSON.parse(event.nativeEvent.data);
        console.error('[NET_LOG]', JSON.stringify(payload));
        return;
      }
      if (type === 'APPLE_LOGIN') {
        handleAppleLogin();
        return;
      }
      if (type === 'KAKAO_LOGIN') {
        if (kakaoLoginInFlight.current) {
          console.error('[KakaoLogin] login already in flight, ignoring');
          return;
        }
        kakaoLoginInFlight.current = true;
        try {
          console.error('[KakaoLogin] calling native login()...');
          const { accessToken, idToken } = await login();
          console.error(
            '[KakaoLogin] login() success, accessToken length:',
            accessToken?.length,
            'idToken:',
            idToken,
          );
          const payload = JSON.stringify({
            type: 'KAKAO_TOKEN',
            payload: { access_token: accessToken, id_token: idToken },
          });
          console.error('[KakaoLogin] injecting KAKAO_TOKEN payload:', payload);
          ref.current?.injectJavaScript(
            `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(
              payload,
            )} })); true;`,
          );
          console.error('[KakaoLogin] injectJavaScript called');
        } catch (e) {
          console.error('[KakaoLogin] login() failed or cancelled:', e);
          const errorPayload = JSON.stringify({
            type: 'KAKAO_LOGIN_ERROR',
            payload: { message: String(e) },
          });
          ref.current?.injectJavaScript(
            `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(
              errorPayload,
            )} })); true;`,
          );
        } finally {
          kakaoLoginInFlight.current = false;
        }
      }
    } catch (e) {
      console.error('[KakaoLogin] onMessage failed:', e);
    }
  };

  const injectedBefore = `
        (function() {
          window.open = function(url){ window.location.href = url; };

          var origFetch = window.fetch;
          window.fetch = function() {
            var args = arguments;
            var url = args[0] && args[0].url ? args[0].url : args[0];
            return origFetch.apply(this, args).then(function(res) {
              try {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'NET_LOG',
                  payload: { url: String(url), status: res.status, ok: res.ok, cookies: document.cookie },
                }));
              } catch (e) {}
              return res;
            }).catch(function(err) {
              try {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'NET_LOG',
                  payload: { url: String(url), error: String(err), cookies: document.cookie },
                }));
              } catch (e) {}
              throw err;
            });
          };

          var origOpen = XMLHttpRequest.prototype.open;
          var origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function(method, url) {
            this.__logUrl = url;
            return origOpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function() {
            var xhr = this;
            xhr.addEventListener('loadend', function() {
              try {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'NET_LOG',
                  payload: {
                    url: String(xhr.__logUrl),
                    status: xhr.status,
                    cookies: document.cookie,
                    responseText: String(xhr.responseText).slice(0, 500),
                  },
                }));
              } catch (e) {}
            });
            return origSend.apply(this, arguments);
          };
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
          onMessage={onMessage}
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
