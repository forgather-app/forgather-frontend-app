import {
  CameraRoll,
  iosReadGalleryPermission,
  iosRequestAddOnlyGalleryPermission,
} from '@react-native-camera-roll/camera-roll';
import { login } from '@react-native-seoul/kakao-login';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { launchImageLibrary } from 'react-native-image-picker';
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

type SaveImagePayload = { url: string; filename?: string };

const guessImageExtension = ({ filename, url }: SaveImagePayload) => {
  const match = (filename || url).match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  return match ? match[1].toLowerCase() : 'jpg';
};

class PhotoPermissionDeniedError extends Error {}

const hasPhotoLibraryPermission = async () => {
  if (Platform.OS === 'android') {
    const permission =
      Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

    if (await PermissionsAndroid.check(permission)) {
      return true;
    }
    const status = await PermissionsAndroid.request(permission);
    return status === PermissionsAndroid.RESULTS.GRANTED;
  }

  const status = await iosReadGalleryPermission('addOnly');
  if (status === 'granted' || status === 'limited') {
    return true;
  }
  if (status === 'not-determined') {
    const requested = await iosRequestAddOnlyGalleryPermission();
    return requested === 'granted' || requested === 'limited';
  }
  return false;
};

const saveImageToDevice = async ({ url, filename }: SaveImagePayload) => {
  if (!(await hasPhotoLibraryPermission())) {
    throw new PhotoPermissionDeniedError('Photo library permission denied');
  }

  const res = await ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: guessImageExtension({ url, filename }),
  }).fetch('GET', url);

  try {
    const path = res.path();
    const localUri = path.startsWith('file://') ? path : `file://${path}`;
    await CameraRoll.saveAsset(localUri, { type: 'photo' });
  } finally {
    res.flush();
  }
};

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

  const postToWeb = (message: unknown) => {
    const payload = typeof message === 'string' ? { type: message } : message;
    ref.current?.injectJavaScript(
      `window.postMessage(${JSON.stringify(JSON.stringify(payload))}, '*'); true;`,
    );
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
      if (type === 'REQUEST_PHOTO_PICKER') {
        const { payload } = JSON.parse(event.nativeEvent.data);
        const maxCount: number = payload?.maxCount > 0 ? payload.maxCount : 1;
        try {
          const result = await launchImageLibrary({
            mediaType: 'photo',
            includeBase64: true,
            selectionLimit: maxCount,
          });

          if (result.didCancel) {
            postToWeb('PHOTO_PICKER_CANCELLED');
            return;
          }
          if (result.errorCode) {
            postToWeb(
              result.errorCode === 'permission'
                ? 'PHOTO_PICKER_PERMISSION_DENIED'
                : 'PHOTO_PICKER_ERROR',
            );
            return;
          }

          const images = (result.assets ?? [])
            .filter(asset => !!asset.base64)
            .map(asset => ({
              base64: asset.base64 as string,
              fileName: asset.fileName ?? `${Date.now()}.jpg`,
              mimeType: asset.type ?? 'image/jpeg',
            }));

          if (images.length === 0) {
            postToWeb('PHOTO_PICKER_ERROR');
            return;
          }

          postToWeb({ type: 'PHOTO_PICKER_RESULT', payload: { images } });
        } catch (e) {
          console.error('[PhotoPicker] failed:', e);
          postToWeb('PHOTO_PICKER_ERROR');
        }
        return;
      }
      if (type === 'SAVE_IMAGE' || type === 'SAVE_IMAGES') {
        const { payload } = JSON.parse(event.nativeEvent.data);
        const images: SaveImagePayload[] =
          type === 'SAVE_IMAGE' ? [payload] : payload.images;
        try {
          for (const image of images) {
            await saveImageToDevice(image);
          }
          postToWeb('SAVE_IMAGE_SUCCESS');
        } catch (e) {
          console.error('[SaveImage] failed:', e);
          postToWeb(
            e instanceof PhotoPermissionDeniedError
              ? 'SAVE_IMAGE_PERMISSION_DENIED'
              : 'SAVE_IMAGE_ERROR',
          );
        }
      }
    } catch (e) {
      console.error('[KakaoLogin] onMessage failed:', e);
    }
  };

  const injectedBefore = `
        (function() {
          function captureToken(text) {
            try {
              var json = JSON.parse(text);
              var token = json && json.data && json.data.accessToken;
              if (token) {
                window.__accessToken = token;
                try {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'NET_LOG',
                    payload: { url: '[TOKEN_CAPTURED]', tokenLength: token.length },
                  }));
                } catch (e) {}
              }
            } catch (e) {}
          }

          window.open = function(url){ window.location.href = url; };

          var origFetch = window.fetch;
          window.fetch = function() {
            var args = arguments;
            var url = args[0] && args[0].url ? args[0].url : args[0];
            if (window.__accessToken) {
              var init = Object.assign({}, args[1] || {});
              var headers = new Headers(init.headers || {});
              if (!headers.has('Authorization')) {
                headers.set('Authorization', 'Bearer ' + window.__accessToken);
              }
              init.headers = headers;
              args = [args[0], init];
            }
            return origFetch.apply(this, args).then(function(res) {
              return res.clone().text().then(captureToken).catch(function() {}).then(function() {
                try {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'NET_LOG',
                    payload: { url: String(url), status: res.status, ok: res.ok, cookies: document.cookie },
                  }));
                } catch (e) {}
                return res;
              });
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
            if (window.__accessToken) {
              try {
                xhr.setRequestHeader('Authorization', 'Bearer ' + window.__accessToken);
              } catch (e) {}
            }
            xhr.addEventListener('loadend', function() {
              captureToken(xhr.responseText);
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
          allowsBackForwardNavigationGestures={Platform.OS === 'ios'}
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
