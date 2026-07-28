// 浮光世界观编辑器 v2.0.0 · electron-builder 配置（JS 以支持自定义 sign 函数）
// 在 Linux 上跨平台打包 Windows 便携版时，用空签名函数跳过 Wine 依赖。
module.exports = {
  appId: 'com.fugu.light.preview',
  productName: '浮光世界观编辑器',
  asar: false,
  icon: 'public/logo/logo_1024x1024.png',
  files: ['dist/**/*', 'electron-main.cjs', 'preload.cjs', 'package.json'],
  win: {
    target: 'portable',
    // 无证书环境下跳过签名（返回原路径即可），避免 electron-builder 调用 Wine
    sign: require('./sign-noop.cjs').default,
  },
  portable: {
    artifactName: '浮光世界观编辑器_v2.0.0.exe',
  },
  directories: {
    output: 'release',
  },
};
