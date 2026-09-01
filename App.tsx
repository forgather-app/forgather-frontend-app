import {
  CameraRoll,
  iosReadGalleryPermission,
  iosRequestAddOnlyGalleryPermission,
} from '@react-native-camera-roll/camera-roll';
import { login } from '@react-native-kakao/user';
import { initializeKakaoSDK } from '@react-native-kakao/core';
import { shareFeedTemplate } from '@react-native-kakao/share';
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
import SHA256 from 'crypto-js/sha256';

// const WEB_URL = __DEV__
//   ? 'https://dev.forgather.app/login'
//   : 'https://forgather.app';
const WEB_URL = 'https://dev.forgather.app';
const BACKGROUND_COLOR = '#1B1D1F';

// KakaoSDKCommon 초기화용 네이티브 앱 키. Info.plist(KAKAO_APP_KEY) / strings.xml(kakao_app_key)와 동일한 값.
const KAKAO_APP_KEY = '6190bb85090cb16a87823f1431f26246';

// TODO: 실제 웹사이트 기본 OG 이미지 URL로 교체
const DEFAULT_SHARE_IMAGE_URL = 'https://dysvfn6jyq7o7.cloudfront.net/images/og-image.png';

const APPLE_FULL_NAME_STORAGE_KEY = 'appleFullName';

// 애플이 내려주는 fullName이 한글(성이 이름보다 앞에 오는 표기) 이름인지 판별
const isKoreanFullName = (value: string) => /[가-힣]/.test(value);

const formatFullName = (
  fullName: { givenName?: string | null; familyName?: string | null } | null,
) => {
  if (!fullName) return null;
  const { givenName, familyName } = fullName;
  const nameParts = [givenName, familyName].filter(Boolean);
  if (!nameParts.length) return null;

  // 한국어 이름은 "성+이름"을 띄어쓰기 없이 이어붙임 (예: 홍길동)
  if (isKoreanFullName(nameParts.join(''))) {
    return [familyName, givenName].filter(Boolean).join('');
  }

  // 그 외(영어 등)는 기존과 동일하게 "이름 성" 순서 유지
  return nameParts.join(' ');
};

// 카카오 로그인에 쓸 nonce(재전송 방지용 원본 값). 백엔드가 이 raw_nonce를
// SHA-256 해싱한 값과 idToken의 nonce 클레임을 대조하므로, 카카오 SDK에는
// 반드시 이 값의 SHA-256 해시를 넘기고, 백엔드에는 원본 값을 그대로 보내야 한다.
const generateNonce = (length = 32) => {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

const MY_DOMAINS = ['dev.forgather.app', 'forgather.app', 'localhost'];
const KAKAO_DOMAINS = ['kauth.kakao.com', 'accounts.kakao.com', 'kakao.com'];

const allowedHost = (host: string) =>
  [...MY_DOMAINS, ...KAKAO_DOMAINS].some(
    h => host === h || host.endsWith(`.${h}`),
  );

const isOurWebUrl = (host: string) =>
  MY_DOMAINS.some(h => host === h || host.endsWith(`.${h}`));

const toWebViewTarget = (url: string) => {
  if (!/^https?:\/\//i.test(url)) {
    return null;
  }
  const host = url.split('/')[2]?.split(':')[0] || '';
  return isOurWebUrl(host) ? url : null;
};

type SaveImagePayload = { url: string; filename?: string };

type KakaoSharePayload = {
  title: string;
  description?: string;
  imageUrl?: string;
  link: string;
  buttonTitle?: string;
};

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
  const [sourceUri, setSourceUri] = useState(WEB_URL);
  const kakaoLoginInFlight = useRef(false);

  useEffect(() => {
    initializeKakaoSDK(KAKAO_APP_KEY);

    const handleIncomingUrl = (url: string | null) => {
      const target = url && toWebViewTarget(url);
      if (target) {
        setSourceUri(target);
      }
    };

    Linking.getInitialURL().then(handleIncomingUrl);
    const sub = Linking.addEventListener('url', ({ url }) =>
      handleIncomingUrl(url),
    );
    return () => sub.remove();
  }, []);

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

    // 최상위 프레임이 아닌 요청(iframe 로드 및 iframe 내부 네비게이션)은 항상
    // WebView 안에서 처리한다. 유튜브 임베드 같은 서드파티 iframe을 외부로
    // 내보내면 임베드 플레이어가 top-level 문서로 열려 재생이 깨진다(Error 153).
    if (req.isTopFrame === false) {
      return true;
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
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(
        JSON.stringify(payload),
      )} })); true;`,
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
          const rawNonce = generateNonce();
          const hashedNonce = SHA256(rawNonce).toString();
          console.error('[KakaoLogin] calling native login()...');
          const { accessToken, idToken } = await login({
            nonce: hashedNonce,
          });
          console.error(
            '[KakaoLogin] login() success, accessToken length:',
            accessToken?.length,
            'idToken:',
            idToken,
          );
          const payload = JSON.stringify({
            type: 'KAKAO_TOKEN',
            payload: {
              access_token: accessToken,
              id_token: idToken,
              nonce: rawNonce,
            },
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
      if (type === 'KAKAO_SHARE') {
        const { payload } = JSON.parse(event.nativeEvent.data) as {
          payload: KakaoSharePayload;
        };
        try {
          await shareFeedTemplate({
            template: {
              content: {
                title: payload.title,
                description: payload.description,
                imageUrl: payload.imageUrl || DEFAULT_SHARE_IMAGE_URL,
                link: { webUrl: payload.link, mobileWebUrl: payload.link },
              },
              buttons: payload.buttonTitle
                ? [
                    {
                      title: payload.buttonTitle,
                      link: { webUrl: payload.link, mobileWebUrl: payload.link },
                    },
                  ]
                : undefined,
            },
            useWebBrowserIfKakaoTalkNotAvailable: false,
          });
        } catch (e) {
          console.error('[KakaoShare] shareFeedTemplate failed:', e);
          postToWeb({ type: 'KAKAO_SHARE_ERROR' });
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
      if (type === 'LOGOUT') {
        // 주입한 인증 토큰을 폐기한다. 이게 없으면 서버/쿠키 로그아웃 후에도
        // injectedBefore가 Bearer를 계속 주입해 세션이 끊기지 않는다.
        ref.current?.injectJavaScript('window.__accessToken = null; true;');
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
          postToWeb({ type: 'SAVE_IMAGE_SUCCESS' });
        } catch (e) {
          console.error('[SaveImage] failed:', e);
          postToWeb({
            type:
              e instanceof PhotoPermissionDeniedError
                ? 'SAVE_IMAGE_PERMISSION_DENIED'
                : 'SAVE_IMAGE_ERROR',
          });
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

          // 로그아웃 응답을 보면 주입한 토큰을 폐기한다.
          // 웹의 LOGOUT 브릿지 메시지를 놓치는 경우까지 커버하는 안전장치.
          function clearTokenOnLogout(url, ok) {
            try {
              if (ok && url && String(url).indexOf('/auth/logout') !== -1) {
                window.__accessToken = null;
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
                clearTokenOnLogout(url, res.ok);
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
              clearTokenOnLogout(xhr.__logUrl, xhr.status >= 200 && xhr.status < 300);
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
      // 취소든 실패든 웹에 알려 로딩 상태를 해제하게 한다.
      // (알리지 않으면 웹의 로그인 버튼이 계속 disabled로 고착됨)
      if (e?.code === appleAuth.Error.CANCELED) {
        postToWeb({ type: 'APPLE_TOKEN_ERROR', payload: { canceled: true } });
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
      <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
        <WebView
          ref={ref}
          source={{ uri: sourceUri }}
          style={{ backgroundColor: BACKGROUND_COLOR }}
          renderLoading={() => <ActivityIndicator size="large" />}
          domStorageEnabled
          javaScriptEnabled
          webviewDebuggingEnabled={__DEV__}
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
