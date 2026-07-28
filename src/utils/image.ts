// ============================================================
// 图片工具：用于在传入视觉模型 / 渲染预览前，把用户上传的
// 可能数 MB 的原图降采样到合理尺寸，避免多模态设卡把巨型
// base64 字符串长期留在 React 状态里、每帧重渲染 MaterialPreview
// 时造成主线程 CPU / 内存暴涨。本地模型推流期间尤其明显。
// ============================================================

/**
 * 把 dataURL 图片等比缩放到最长边不超过 maxDim 像素，并以白底 JPEG 输出
 * （透明区域填白，避免黑底；体积约 100-300KB，远低于原图的数 MB）。
 * 若原图已小于 maxDim，直接返回原图，避免无意义重编码。
 * @returns 降采样后的 dataURL；解码失败时回退原图。
 */
export function downscaleImage(dataUrl: string, maxDim = 1024, quality = 0.85): Promise<string> {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (!width || !height || (width <= maxDim && height <= maxDim)) {
        resolve(dataUrl);
        return;
      }
      const scale = Math.min(maxDim / width, maxDim / height);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        // 白底填充，避免透明区域在 JPEG 下变成黑色
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
