import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageNodeView } from './ImageNodeView';

export type ImageAlign = 'inline' | 'left' | 'right' | 'center';

/** 扩展 Image：使用自定义 NodeView 渲染，支持选中、旋转、缩放工具条。 */
export const ImageWrap = Image.extend({
  name: 'image',

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'center' as ImageAlign,
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-align') as ImageAlign) || 'center',
        renderHTML: (attrs: Record<string, any>) => ({
          'data-align': attrs.align,
          class: `align-${attrs.align}`,
        }),
      },
      rotation: {
        default: 0,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-rotation')) || 0,
        renderHTML: (attrs: Record<string, any>) => ({ 'data-rotation': attrs.rotation }),
      },
      width: {
        default: 360,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-width')) || 360,
        renderHTML: (attrs: Record<string, any>) => ({ 'data-width': attrs.width }),
      },
      height: {
        default: 0,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-height')) || 0,
        renderHTML: (attrs: Record<string, any>) => ({ 'data-height': attrs.height }),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align: ImageAlign) =>
        ({ commands }: any) =>
          commands.updateAttributes('image', { align }),
      setImageRotation:
        (rotation: number) =>
        ({ commands }: any) =>
          commands.updateAttributes('image', { rotation }),
      setImageSize:
        (width: number, height = 0) =>
        ({ commands }: any) =>
          commands.updateAttributes('image', { width, height }),
    } as any;
  },
});
