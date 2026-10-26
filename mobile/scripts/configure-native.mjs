/**
 * `npx cap add ios / android` で作られたネイティブプロジェクトに、King Horn に必要な設定を書き込む。
 * 何度実行しても同じ結果になる（既に書いてあれば何もしない）。
 *
 * 環境変数（未設定ならテスト用の値）:
 *   ADMOB_APP_ID_IOS / ADMOB_APP_ID_ANDROID   AdMob のアプリID（ca-app-pub-...~...）
 *   GOOGLE_IOS_CLIENT_ID                      Google サインイン（iOS）のクライアントID
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEST_ADMOB = { ios: 'ca-app-pub-3940256099942544~1458002511', android: 'ca-app-pub-3940256099942544~3347511713' };
const admobIos = process.env.ADMOB_APP_ID_IOS || TEST_ADMOB.ios;
const admobAndroid = process.env.ADMOB_APP_ID_ANDROID || TEST_ADMOB.android;
const googleIos = process.env.GOOGLE_IOS_CLIENT_ID || '';

function patch(file, fn) {
  if (!existsSync(file)) return false;
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
  console.log(`${after !== before ? 'updated' : 'ok     '}  ${file.replace(root, '')}`);
  return true;
}

/* ---------------- iOS ---------------- */

const plist = join(root, 'ios/App/App/Info.plist');
patch(plist, (s) => {
  const add = (key, xml) => (s.includes(`<key>${key}</key>`) ? s : s.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t${xml}`));
  s = add('GADApplicationIdentifier', `<string>${admobIos}</string>`);
  s = add('NSUserTrackingUsageDescription', '<string>あなたに合った広告を表示するために使用します。</string>');
  s = add(
    'SKAdNetworkItems',
    '<array>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>cstr6suwn9.skadnetwork</string>\n\t\t</dict>\n\t</array>',
  );
  s = add('ITSAppUsesNonExemptEncryption', '<false/>');
  if (googleIos) {
    // Google サインインのコールバック用 URL スキーム（クライアントIDを逆順にしたもの）
    const reversed = googleIos.split('.').reverse().join('.');
    if (!s.includes(reversed))
      s = s.replace(
        /<dict>/,
        `<dict>\n\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${reversed}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>`,
      );
  }
  return s;
});

// Appleでサインイン の権限（entitlements）
const entFile = join(root, 'ios/App/App/App.entitlements');
if (existsSync(join(root, 'ios/App/App'))) {
  if (!existsSync(entFile)) {
    writeFileSync(
      entFile,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.applesignin</key>
\t<array>
\t\t<string>Default</string>
\t</array>
</dict>
</plist>
`,
    );
    console.log('created  ios/App/App/App.entitlements');
  }
  patch(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), (s) =>
    s.includes('CODE_SIGN_ENTITLEMENTS') ? s : s.replace(/(\n(\s*)PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)/g, '\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1'),
  );
}

/* ---------------- Android ---------------- */

patch(join(root, 'android/app/src/main/AndroidManifest.xml'), (s) => {
  if (s.includes('com.google.android.gms.ads.APPLICATION_ID')) return s;
  return s.replace(
    /(<application[^>]*>)/,
    `$1\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobAndroid}" />`,
  );
});

if (admobIos === TEST_ADMOB.ios || admobAndroid === TEST_ADMOB.android) console.log('※ AdMob はテスト用のアプリIDです（ADMOB_APP_ID_IOS / ADMOB_APP_ID_ANDROID で本番の ID を指定）');
