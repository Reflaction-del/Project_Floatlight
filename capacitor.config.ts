import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fugu.light.editor',
  appName: '浮光世界观编辑器',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // 平板优先：允许横屏/竖屏，支持平板分屏
    allowMixedContent: false,
    backgroundColor: '#202020',
    buildOptions: {
      keystorePath: undefined,
    },
  },
};

export default config;
