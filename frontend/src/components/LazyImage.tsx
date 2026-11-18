import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LazyImageProps {
  /** 图片地址，为空时显示占位 */
  src?: string;
  /** 替代文本 */
  alt: string;
  /** 应用到 img 元素的额外类名（如 h-full w-full object-cover） */
  className?: string;
  /** 占位容器类名，默认填充父容器 */
  containerClassName?: string;
  /** 预加载根边距，默认 100px */
  rootMargin?: string;
}

/**
 * 懒加载图片组件
 * - 使用 IntersectionObserver 在进入视口前 100px 才加载图片
 * - 加载中显示渐变流光骨架屏
 * - 加载失败显示 ImageOff 占位
 * - 加载完成淡入显示
 */
export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  className,
  containerClassName,
  rootMargin = '100px',
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [inView, setInView] = useState(false);

  // 监听图片是否进入视口
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  // src 变化时重置状态
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  const showSkeleton = src && !loaded && !error;
  const showError = error || !src;

  return (
    <>
      {showSkeleton && (
        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-br from-muted to-muted/70 animate-pulse',
            containerClassName
          )}
        />
      )}
      {showError && (
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/70',
            containerClassName
          )}
        >
          <ImageOff className="h-6 w-6 text-muted-foreground/60" />
        </div>
      )}
      <img
        ref={imgRef}
        src={inView && src ? src : undefined}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={cn(
          'transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
          className
        )}
      />
    </>
  );
};
