// Electron 预加载注入的渲染进程 API
export {};
declare global {
  interface Window {
    api?: {
      /** 唤起系统文件选择器，返回图片的 dataURL 或 null */
      openImage: () => Promise<string | null>;
      /** 列出系统已安装字体，返回字体族名数组 */
    listFonts: () => Promise<string[]>;
      exportPdf: (htmlContent: string, title: string) => Promise<boolean>;
      /** 调起系统保存对话框，写入 content */
      exportFile: (defaultName: string, content: string) => Promise<boolean>;
      /** 视觉物料生成器：离屏截图返回 PNG dataURL 或 null */
      captureMaterialPng: (
        html: string,
        opts?: { width?: number; height?: number; scale?: number },
      ) => Promise<string | null>;
      /** 视觉物料生成器：直接截取当前窗口预览区并保存 PNG（所见即所得） */
      exportPreviewPng: (
        rect: { x: number; y: number; width: number; height: number },
        defaultName: string,
      ) => Promise<boolean>;
      /** 视觉物料生成器：截图并保存 PNG（印刷） */
      exportMaterialPng: (
        html: string,
        opts: { width: number; height: number; scale: number; defaultName: string },
      ) => Promise<boolean>;
      /** 视觉物料生成器：打印并保存 PDF（印刷，自定义毫米尺寸） */
      exportMaterialPdf: (
        html: string,
        opts: { widthMm: number; heightMm: number; defaultName: string },
      ) => Promise<boolean>;
      /** 视觉物料生成器：选择批量导出目录，返回路径或 null */
      pickFolder: () => Promise<string | null>;
      /** 视觉物料生成器：批量写入 PNG 序列 + manifest.json，返回 { written, folder } */
      materialExportBatch: (
        folder: string,
        items: { filename: string; dataUrl: string; entityId?: string; entityName?: string }[],
      ) => Promise<{ written: number; folder: string | null; error?: string }>;
    };
  }
}
