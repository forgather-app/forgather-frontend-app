import React from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';

const BACKGROUND_COLOR = '#1B1D1F';

// Figma 스플래시(node 2946:10596) 기준 로고 락업 비율.
// - 화면 폭 360 중 208 (약 57.8%)
// - 원본 이미지 비율 210 x 98
const LOGO_WIDTH_RATIO = 208 / 360;
const LOGO_ASPECT_RATIO = 210 / 98;

// 웹뷰가 첫 화면을 그리기 전까지 노출되는 스플래시.
// 네이티브 런치 스크린(iOS LaunchScreen.storyboard / Android SplashTheme)과 동일한
// 배경·로고를 사용해 콜드 스타트에서 웹 로드 완료까지 이음매 없이 이어지도록 한다.
const SplashScreen = () => {
  const { width } = useWindowDimensions();
  const logoWidth = width * LOGO_WIDTH_RATIO;

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/splash/splash-logo.png')}
        style={{ width: logoWidth, aspectRatio: LOGO_ASPECT_RATIO }}
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
});

export default SplashScreen;
