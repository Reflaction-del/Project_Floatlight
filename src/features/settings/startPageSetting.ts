// 开始页开关设置（独立 localStorage，避免侵入其他 store）
const KEY = 'fl-show-start-page';

/** 读取「启动时显示开始页」开关状态；默认开启 */
export function getStartPageEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

/** 写入开关状态 */
export function setStartPageEnabled(v: boolean): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* ignore */
  }
}
