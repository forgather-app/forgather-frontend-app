#!/usr/bin/env bash
# 앱을 iOS 시뮬레이터에서 실행하고, 카카오 로그인이 완료되면
# 백엔드 confirm 응답에서 accessToken/refreshToken을 자동으로 추출한다.
#
# 사용법: ./scripts/extract-kakao-token.sh
# 환경변수:
#   SIM_NAME  - 사용할 시뮬레이터 이름 (기본: 이미 부팅된 시뮬레이터, 없으면 "iPhone 17 Pro")
#   TIMEOUT   - 로그인 대기 타임아웃 초 (기본: 180)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="com.forgatherapp"
TIMEOUT="${TIMEOUT:-180}"
cd "$APP_DIR"

booted_udid() {
  xcrun simctl list devices | awk -F'[()]' '/Booted/{print $2; exit}'
}

if [ -z "$(booted_udid)" ]; then
  SIM_NAME="${SIM_NAME:-iPhone 17 Pro}"
  echo "==> 부팅된 시뮬레이터가 없어 '$SIM_NAME'을 부팅합니다..."
  xcrun simctl boot "$SIM_NAME"
  open -a Simulator
  sleep 5
fi

if ! lsof -i :8081 >/dev/null 2>&1; then
  echo "==> Metro 번들러 시작..."
  nohup npx react-native start > /tmp/forgather-metro.log 2>&1 &
  disown
  sleep 5
fi

if xcrun simctl listapps booted 2>/dev/null | grep -q "$BUNDLE_ID"; then
  echo "==> 앱 재시작..."
  xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
  sleep 1
  xcrun simctl launch booted "$BUNDLE_ID" >/dev/null
else
  echo "==> 앱이 설치되어 있지 않아 빌드 후 설치합니다 (몇 분 소요)..."
  npx react-native run-ios
fi

START_TS="$(date '+%Y-%m-%d %H:%M:%S')"

echo ""
echo "==> 시뮬레이터에서 카카오 로그인을 진행해 주세요. (최대 ${TIMEOUT}초 대기)"
echo ""

ELAPSED=0
FOUND=""
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  FOUND="$(xcrun simctl spawn booted log show \
    --predicate 'eventMessage contains "NET_LOG" and eventMessage contains "confirm" and eventMessage contains "accessToken"' \
    --style compact --start "$START_TS" 2>/dev/null | grep -v '^Filtering' | tail -1 || true)"
  if [ -n "$FOUND" ]; then
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done

if [ -z "$FOUND" ]; then
  echo "타임아웃: ${TIMEOUT}초 동안 로그인 완료를 감지하지 못했습니다."
  exit 1
fi

ACCESS="$(grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' <<< "$FOUND" | sed -n '1p')"
REFRESH="$(grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' <<< "$FOUND" | sed -n '2p')"

if [ -z "$ACCESS" ]; then
  echo "로그인 응답은 감지했지만 토큰 파싱에 실패했습니다. 원본 로그:"
  echo "$FOUND"
  exit 1
fi

echo ""
echo "accessToken:"
echo "$ACCESS"
if [ -n "$REFRESH" ]; then
  echo ""
  echo "refreshToken:"
  echo "$REFRESH"
fi
