import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/SectionHeader';
import { MediaCard } from '@/components/MediaCard';
import { HistoryCard, convertHistoryToCardData, type HistoryCardData } from '@/components/HistoryCard';
import { useDragScroll } from '@/hooks/use-drag-scroll';
import { useFavorites } from '@/contexts/FavoritesContext';
import { convertVideoToMediaItem } from '@/utils/videoConvert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { MediaItem } from '@/types';

const SECTION_GAP = 24;
const CARD_WIDTH = 160;
const HISTORY_CARD_WIDTH = 240;
const DEFAULT_CATEGORY_COUNT = 8;

/** 分类元数据 */
interface CategoryMeta {
  id: string | number;
  name: string;
  subcategories?: { id: string | number; name: string }[];
}

/** 单个分类的加载状态 */
interface CategoryState {
  videos: MediaItem[];
  loading: boolean;
  loaded: boolean;
}

const MediaRow: React.FC<{ items: MediaItem[]; title: string; categoryId: string; categoryCount: number }> = ({
  items,
  title,
  categoryId,
  categoryCount,
}) => {
  const [scrollRef, isDragging] = useDragScroll<HTMLDivElement>();
  const { toggleFavorite, isFavorite } = useFavorites();
  const navigate = useNavigate();

  const rowWidth = useMemo(
    () => categoryCount * CARD_WIDTH + (categoryCount - 1) * SECTION_GAP,
    [categoryCount]
  );

  return (
    <section>
      <SectionHeader
        title={title}
        onMore={() => navigate(`/list/${categoryId}`)}
      />
      <div
        ref={scrollRef}
        className={cn(
          'flex gap-6 overflow-x-auto pb-4 select-none scrollbar-hide',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ minWidth: 0 }}
      >
        <div className="flex gap-6" style={{ minWidth: rowWidth, paddingRight: 24 }}>
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              showFavorite
              favorite={isFavorite(item.id)}
              onFavoriteToggle={toggleFavorite}
              className="w-40"
            />
          ))}
        </div>
      </div>
    </section>
  );
};

/** 骨架行：分类加载中时显示 */
const SkeletonCategoryRow: React.FC = () => (
  <section>
    <div className="shimmer h-6 w-32 rounded mb-5" />
    <div className="flex gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="w-40 shrink-0">
          <div className="shimmer aspect-[2/3] w-full rounded-xl" />
          <div className="shimmer mt-3 h-4 w-3/4 rounded" />
          <div className="shimmer mt-2 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  </section>
);

/**
 * 懒加载分类区域：通过 IntersectionObserver 在滚动到可视区域时触发加载。
 * 数据到达后即时显示，无需等待其他分类。
 */
const LazyCategorySection: React.FC<{
  category: CategoryMeta;
  categoryCount: number;
  state: CategoryState;
  onVisible: (category: CategoryMeta) => void;
}> = ({ category, categoryCount, state, onVisible }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggeredRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !triggeredRef.current) {
            triggeredRef.current = true;
            onVisible(category);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '300px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [category, onVisible]);

  // 已加载但无数据：隐藏该分类
  if (state.loaded && state.videos.length === 0) return null;

  return (
    <div ref={containerRef}>
      {state.loading || !state.loaded ? (
        <SkeletonCategoryRow />
      ) : (
        <MediaRow
          title={category.name}
          categoryId={String(category.id)}
          items={state.videos.slice(0, categoryCount)}
          categoryCount={categoryCount}
        />
      )}
    </div>
  );
};

/** 历史记录行：使用 landscape 历史卡片，支持删除和清空 */
const HistoryRow: React.FC<{
  items: HistoryCardData[];
  /** 原始历史记录映射（id -> raw record），点击卡片时直接传给播放器 */
  rawMap: Record<string, Record<string, unknown>>;
  onDelete: (item: HistoryCardData) => void;
  onClearAll: () => void;
}> = ({ items, rawMap, onDelete, onClearAll }) => {
  const [scrollRef, isDragging] = useDragScroll<HTMLDivElement>();
  const rowWidth = useMemo(
    () => items.length * HISTORY_CARD_WIDTH + (items.length - 1) * SECTION_GAP,
    [items.length]
  );

  return (
    <section>
      <SectionHeader
        title="观看历史"
        action={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="flex items-center gap-0.5 text-sm text-destructive hover:text-destructive/80 transition-colors">
                全部清空
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认清空观看历史？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将清除所有观看记录，无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={onClearAll}>确认清空</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
      <div
        ref={scrollRef}
        className={cn(
          'flex gap-6 overflow-x-auto pb-4 select-none scrollbar-hide',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ minWidth: 0 }}
      >
        <div className="flex gap-6" style={{ minWidth: rowWidth, paddingRight: 24 }}>
          {items.map((item) => (
            <HistoryCard
              key={`${item.id}_${item.sourceKey ?? 'default'}`}
              item={item}
              rawHistory={rawMap[item.id]}
              onDelete={onDelete}
              className="w-60"
            />
          ))}
        </div>
      </div>
    </section>
  );
};

const Home: React.FC = () => {
  const [history, setHistory] = useState<HistoryCardData[]>([]);
  // 原始历史记录映射（id -> raw record），点击卡片时直接传给播放器，避免详情页信息不全
  const [historyRawMap, setHistoryRawMap] = useState<Record<string, Record<string, unknown>>>({});
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [categoryData, setCategoryData] = useState<Record<string, CategoryState>>({});
  const [categoryCount, setCategoryCount] = useState<number>(DEFAULT_CATEGORY_COUNT);
  // loading 仅表示分类元数据加载中（快速），视频数据由懒加载触发
  const [loading, setLoading] = useState(true);
  // 请求纪元：每次 loadData 递增，loadCategory 回调中检查是否过期，避免竞态覆盖
  const loadEpochRef = useRef(0);

  useEffect(() => {
    if (!window.API?.settings?.get) return;
    window.API.settings.get('ui.homeCategoryCount').then((value: unknown) => {
      if (typeof value === 'number' && value >= 4 && value <= 20) {
        setCategoryCount(value);
      }
    });
  }, []);

  /**
   * 加载单个分类的视频列表。
   * 数据到达后即时更新对应分类的 state，无需等待其他分类。
   * 失败时尝试回退到首个子分类。
   */
  const loadCategory = useCallback(async (category: CategoryMeta) => {
    if (!window.API?.video?.getVideos) return;
    const catId = String(category.id);
    const subcategories = category.subcategories || [];
    if (subcategories.length === 0) {
      setCategoryData((prev) => ({ ...prev, [catId]: { videos: [], loading: false, loaded: true } }));
      return;
    }

    // 捕获当前请求纪元，回调中检查是否已过期（用户切换源或路由导致重新加载）
    const epoch = loadEpochRef.current;

    // 标记加载中，立即显示骨架屏
    setCategoryData((prev) => ({ ...prev, [catId]: { videos: [], loading: true, loaded: false } }));

    const subcategoryIds = subcategories.map((s) => s.id).join(',');
    try {
      const response = await window.API.video.getVideos(subcategoryIds, { pg: 1 });
      if (epoch !== loadEpochRef.current) return; // 请求已过期，丢弃结果
      const videoList = ((response as Record<string, unknown>)?.list || []) as Record<string, unknown>[];
      const videos = videoList.map(convertVideoToMediaItem);
      // 即时显示：数据到达立即更新
      setCategoryData((prev) => ({ ...prev, [catId]: { videos, loading: false, loaded: true } }));
      return;
    } catch {
      // 回退：尝试仅用第一个子分类 ID
    }

    try {
      const firstSubId = subcategories[0]?.id;
      if (firstSubId) {
        const response = await window.API.video.getVideos(firstSubId, { pg: 1 });
        if (epoch !== loadEpochRef.current) return; // 请求已过期，丢弃结果
        const videoList = ((response as Record<string, unknown>)?.list || []) as Record<string, unknown>[];
        const videos = videoList.map(convertVideoToMediaItem);
        setCategoryData((prev) => ({ ...prev, [catId]: { videos, loading: false, loaded: true } }));
        return;
      }
    } catch {
      // 回退也失败
    }

    if (epoch !== loadEpochRef.current) return; // 请求已过期，丢弃结果
    setCategoryData((prev) => ({ ...prev, [catId]: { videos: [], loading: false, loaded: true } }));
  }, []);

  /**
   * 加载首页数据：历史记录 + 分类元数据。
   * 分类视频通过 LazyCategorySection 的 IntersectionObserver 懒加载，
   * 数据到达后即时显示，首屏只加载可见的分类。
   */
  const loadData = useCallback(async () => {
    if (!window.API) return;
    // 递增纪元，使之前所有在途请求的回调失效
    loadEpochRef.current++;
    setLoading(true);
    setCategoryData({});

    // 历史记录独立加载，不阻塞分类
    window.API.user.getHistory({ limit: 20 }).then((data: unknown) => {
      const list = Array.isArray(data) ? data : [];
      const rawList = list as Record<string, unknown>[];
      setHistory(rawList.map((item) => convertHistoryToCardData(item)));
      // 构建原始记录映射（id -> raw record），点击卡片时直接传给播放器继续播放
      const rawMap: Record<string, Record<string, unknown>> = {};
      rawList.forEach((item) => {
        const id = String(
          item.videoId ?? item.id ?? (item.video as Record<string, unknown> | undefined)?.vod_id ?? ''
        );
        if (id) {
          rawMap[id] = item;
        }
      });
      setHistoryRawMap(rawMap);
    });

    // 仅加载分类元数据（快速），视频数据由懒加载触发
    const cats = await window.API.video.getCategories();
    const catList = Array.isArray(cats) ? (cats as CategoryMeta[]) : [];
    setCategories(catList);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const handler = () => loadData();
    window.addEventListener('source:changed', handler);
    return () => window.removeEventListener('source:changed', handler);
  }, [loadData]);

  /** 删除单条历史记录 */
  const handleDeleteHistory = (item: HistoryCardData) => {
    if (!window.API?.user?.removeHistory) return;
    window.API.user.removeHistory(item.id, item.sourceKey).then(() => {
      setHistory((prev) => prev.filter((h) => h.id !== item.id));
    });
  };

  /** 清空所有历史记录 */
  const handleClearHistory = () => {
    if (!window.API?.user?.clearHistory) return;
    window.API.user.clearHistory().then(() => {
      setHistory([]);
    });
  };

  if (loading) {
    return (
      <div className="space-y-12">
        <SkeletonCategoryRow />
        <SkeletonCategoryRow />
      </div>
    );
  }

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {history.length > 0 && (
        <HistoryRow
          items={history}
          rawMap={historyRawMap}
          onDelete={handleDeleteHistory}
          onClearAll={handleClearHistory}
        />
      )}
      {categories.map((cat) => (
        <LazyCategorySection
          key={String(cat.id)}
          category={cat}
          categoryCount={categoryCount}
          state={categoryData[String(cat.id)] || { videos: [], loading: false, loaded: false }}
          onVisible={loadCategory}
        />
      ))}
    </div>
  );
};

export default Home;
