import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const BACKGROUND_COLOR = '#1B1D1F';

// Figma 스플래시(node 2946:10596) 기준 로고 락업 크기.
// - 원본 이미지 비율 210 x 98
// 네이티브 콜드 스타트 스플래시(Android splash_screen.xml 의 고정 210dp 비트맵,
// iOS LaunchScreen.storyboard)와 동일하게 화면폭 비율이 아닌 고정 크기를 사용해
// 네이티브 → 웹뷰 스플래시 전환 시 로고가 커지거나 줄어들어 보이지 않도록 한다.
const LOGO_WIDTH = 210;
const LOGO_HEIGHT = 98;

// 웹뷰가 첫 화면을 그리기 전까지 노출되는 스플래시.
// 네이티브 런치 스크린(iOS LaunchScreen.storyboard / Android SplashTheme)과 동일한
// 배경·로고를 사용해 콜드 스타트에서 웹 로드 완료까지 이음매 없이 이어지도록 한다.
const SplashScreen = () => {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/splash/splash-logo.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Forgather"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BACKGROUND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
});

export default SplashScreen;
