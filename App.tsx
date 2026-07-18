import { login } from '@react-native-seoul/kakao-login';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  SafeAreaView,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

const WEB_URL = __DEV__
  ? 'https://dev.forgather.app/login'
  : 'https://forgather.app';

const MY_DOMAINS = ['dev.forgather.app', 'forgather.app', 'localhost'];
const KAKAO_DOMAINS = ['kauth.kakao.com', 'accounts.kakao.com', 'kakao.com'];

const allowedHost = (host: string) =>
  [...MY_DOMAINS, ...KAKAO_DOMAINS].some(
    h => host === h || host.endsWith(`.${h}`),
  );

const App = () => {
  const ref = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
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
      const u = new URL(url);
      if (
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        allowedHost(String((u as any).host).split(':')[0])
      ) {
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

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {loading && (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <ActivityIndicator size="large" />
        </View>
      )}
      <WebView
        ref={ref}
        source={{ uri: WEB_URL }}
        domStorageEnabled
        javaScriptEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        startInLoadingState
        setSupportMultipleWindows={false}
        pullToRefreshEnabled={Platform.OS === 'android'}
        onNavigationStateChange={s => setCanGoBack(s.canGoBack)}
        onLoadEnd={() => setLoading(false)}
        onShouldStartLoadWithRequest={onShouldStart}
        onMessage={onMessage}
        onCreateWindow={() => false}
        onFileDownload={({ nativeEvent }) => {
          Linking.openURL(nativeEvent.downloadUrl);
        }}
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        userAgent={`ForgatherWebview/1.0 (iOS) WebView`}
      />
    </SafeAreaView>
  );
};

export default App;
