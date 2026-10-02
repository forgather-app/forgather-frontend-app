import * as Sentry from '@sentry/react-native';
import PostHog from 'posthog-react-native';

// forgather-wh 조직 안에 이 앱(React Native) 전용으로 만든 별도 프로젝트의 DSN.
// 웹(forgather-frontend-web-v3)과 플랫폼이 달라 이슈 그룹핑/스택트레이스 형식이
// 섞이지 않도록 프로젝트를 분리했다.
const SENTRY_DSN =
  'https://b8f815df3b726cca7af5b0c4949ff10b@o4509864008351744.ingest.us.sentry.io/4512139852578816';

// 웹과 동일한 PostHog 프로젝트를 공유한다. PostHog는 사용자/이벤트 단위 분석이라
// 플랫폼을 섞어도 무방하고, 아래 register()로 platform 속성만 구분해둔다.
const POSTHOG_KEY = 'phc_kiSnKViTBPb4qHWwXoDpdBpr7yNABEqccqTU5FfDgx3P';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// __DEV__(로컬 Metro 개발 빌드)에서는 비활성화해, 개발 중 발생하는 노이즈가 실제
// 배포 빌드(TestFlight/스토어) 데이터에 섞이지 않게 한다.
const isDev = __DEV__;

/** index.js에서 앱 등록 전, 가장 먼저 한 번만 호출한다. */
export const initSentry = () => {
  if (isDev) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: 'production',
    sendDefaultPii: true,
  });

  Sentry.setTag('platform', 'native');
};

export const posthog = new PostHog(POSTHOG_KEY, {
  host: POSTHOG_HOST,
  // NOTE: disabled로 두면 SDK가 내부적으로 완전히 no-op이 되므로, 호출부에서
  // 매번 dev 여부를 따로 체크할 필요가 없다.
  disabled: isDev,
});

posthog.register({ platform: 'native' });
