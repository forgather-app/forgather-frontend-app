package com.forgather.app

import android.webkit.CookieManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// WebView 로그인 흐름이 SPA 클라이언트 라우팅으로만 이어지면 onPageFinished가 다시
// 발생하지 않아 Android CookieManager가 세션 쿠키를 디스크에 flush하지 않는다.
// 웹이 로그인 확정을 알려올 때 이 모듈로 명시적으로 flush한다.
class CookieFlushModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "CookieFlush"

  @ReactMethod
  fun flush() {
    CookieManager.getInstance().flush()
  }
}
