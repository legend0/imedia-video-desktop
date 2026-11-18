import { useRef, useState, useEffect, type RefObject } from 'react';

/** 拖拽阈值：移动距离超过此值才视为拖拽，避免误触点击 */
const DRAG_THRESHOLD = 5;

/**
 * 横向拖拽滚动 Hook
 * 支持鼠标和触摸，拖拽后自动抑制下一次 click 事件以防误触发卡片导航
 * @returns [ref, isDragging] - 绑定到滚动容器的 ref 和拖拽状态
 */
export function useDragScroll<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let startX = 0;
    let scrollLeft = 0;
    let hasMoved = false;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      hasMoved = false;
      startX = e.clientX - element.getBoundingClientRect().left;
      scrollLeft = element.scrollLeft;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const x = e.clientX - element.getBoundingClientRect().left;
      const walk = (x - startX) * 1.2;
      if (Math.abs(walk) > DRAG_THRESHOLD) {
        hasMoved = true;
        setIsDragging(true);
      }
      element.scrollLeft = scrollLeft - walk;
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      // 拖拽后阻止后续 click 事件冒泡，避免误触发卡片导航
      if (hasMoved) {
        const suppressClick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          element.removeEventListener('click', suppressClick, true);
        };
        element.addEventListener('click', suppressClick, true);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      isDraggingRef.current = true;
      hasMoved = false;
      startX = e.touches[0].clientX - element.getBoundingClientRect().left;
      scrollLeft = element.scrollLeft;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      const x = e.touches[0].clientX - element.getBoundingClientRect().left;
      const walk = (x - startX) * 1.2;
      if (Math.abs(walk) > DRAG_THRESHOLD) {
        hasMoved = true;
        setIsDragging(true);
      }
      element.scrollLeft = scrollLeft - walk;
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };

    element.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  return [ref as RefObject<T>, isDragging];
}
