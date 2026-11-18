import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Film, Search as SearchIcon } from 'lucide-react';
import { MediaCard } from '@/components/MediaCard';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useSearch } from '@/contexts/SearchContext';
import { cn } from '@/lib/utils';
import type { MediaItem } from '@/types';
import { convertVideoToMediaItem } from '@/utils/videoConvert';

interface Subcategory {
  id: string | number;
  name: string;
}

interface Category {
  id: string | number;
  name: string;
  icon?: string;
  subcategories?: Subcategory[];
}

/** 子分类默认显示数量，超出部分折叠 */
const VISIBLE_SUB_COUNT = 5;

/** 列表页缓存条目：保存视频列表、分页、滚动位置，用于从详情页返回时恢复 */
interface ListPageCache {
  videos: MediaItem[];
  page: number;
  hasMore: boolean;
  scrollY: number;
}

/**
 * 列表页缓存：按 "categoryId::selectedSubs" 缓存视频列表与滚动位置。
 * 模块级 Map，组件卸载时不丢失，仅在同一路由生命周期内有效。
 * - 保存时机：List 组件卸载（进入详情页）或切换子分类（保存旧子分类数据）
 * - 恢复时机：List 组件首次挂载且有匹配缓存（从详情页返回）
 * - 子分类切换时不恢复（reset 到顶部），符合 "分类切换时回到顶部" 的预期
 */
const listPageCache = new Map<string, ListPageCache>();

/** 构造缓存键：categoryId + selectedSubs 唯一标识一个列表视图 */
function getListCacheKey(categoryId: string | undefined, selectedSubs: string): string {
  return `${categoryId ?? ''}::${selectedSubs}`;
}

/**
 * 获取列表页的滚动容器（AppLayout 中的 <main> 元素，overflow-y-auto）。
 * 注意：
 * - 不是 window，window.scrollY 始终为 0。
 * - App.tsx 中也存在一个 <main className="flex-grow">（非滚动容器），
 *   document.querySelector('main') 会返回那个元素，导致 scrollTop 操作无效。
 *   因此用 .overflow-y-auto 类精确匹配 AppLayout 中的滚动容器。
 */
function getScrollContainer(): HTMLElement | null {
  return document.querySelector('main.overflow-y-auto');
}

const SkeletonCard: React.FC = () => (
  <div className="w-full">
    <div className="shimmer aspect-[2/3] w-full rounded-xl" />
    <div className="shimmer mt-3 h-4 w-3/4 rounded" />
    <div className="shimmer mt-2 h-3 w-1/2 rounded" />
  </div>
);

const List: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toggleFavorite, isFavorite } = useFavorites();

  /** 全局搜索关键词：由 SearchContext 管理，跨分类切换保持 */
  const { searchKeyword } = useSearch();
  const isSearchMode = searchKeyword.trim().length > 0;

  const [category, setCategory] = useState<Category | null>(null);
  const [videos, setVideos] = useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [subDropdownOpen, setSubDropdownOpen] = useState(false);

  const pageRef = useRef(1);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const videosLenRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** 当前视频列表的 ref 镜像，供卸载时 cleanup 读取最新值写入缓存 */
  const videosRef = useRef<MediaItem[]>([]);
  /** 是否为组件首次有效挂载（用于区分"从详情页返回"与"子分类切换"） */
  const isInitialMountRef = useRef(true);
  /**
   * 实时跟踪滚动位置（通过 scroll 事件）。
   * 必要性：组件卸载 cleanup 执行时，<main> 内容可能已被替换为详情页，
   * 此时 container.scrollTop 会被浏览器调整，读取到错误值。
   * 用 ref 缓存 scroll 事件中的最新值，cleanup 读取 ref 即可拿到离开前的真实位置。
   */
  const scrollYRef = useRef(0);

  const selectedSubs = searchParams.get('category') || '';

  /** 同步 videos 到 videosRef，供 cleanup 读取 */
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  /**
   * 监听滚动容器的 scroll 事件，实时更新 scrollYRef。
   * - passive: true 避免阻塞滚动性能
   * - 仅在非搜索模式下跟踪（搜索结果不需要恢复滚动位置）
   */
  useEffect(() => {
    if (isSearchMode) return;
    const container = getScrollContainer();
    if (!container) return;
    scrollYRef.current = container.scrollTop;
    const handleScroll = () => {
      scrollYRef.current = container.scrollTop;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isSearchMode]);

  /** 加载视频列表 */
  const loadVideos = useCallback(
    async (pageNum: number, subIds: string, reset: boolean) => {
      if (!window.API?.video?.getVideos || !subIds) return;
      loadingRef.current = true;
      setLoading(true);
      setError('');
      // 子分类切换时立即清空旧内容，让用户看到加载状态而非停留的旧数据
      if (reset) {
        setVideos([]);
        videosLenRef.current = 0;
      }

      try {
        const response = await window.API.video.getVideos(subIds, { pg: pageNum });
        const result = (response || {}) as Record<string, unknown>;
        const list = (result.list as Record<string, unknown>[]) || [];
        const total = (result.total as number) || 0;

        if (list.length === 0) {
          if (reset) {
            setVideos([]);
            videosLenRef.current = 0;
          }
          setHasMore(false);
          hasMoreRef.current = false;
          return;
        }

        const newItems = list.map(convertVideoToMediaItem);
        const prevLen = reset ? 0 : videosLenRef.current;
        const nextLen = prevLen + newItems.length;
        videosLenRef.current = nextLen;
        setVideos((prev) => (reset ? newItems : [...prev, ...newItems]));
        const nextHasMore = nextLen < total;
        setHasMore(nextHasMore);
        hasMoreRef.current = nextHasMore;
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    []
  );

  /** 加载分类信息 */
  useEffect(() => {
    if (!categoryId || !window.API?.video?.getCategories) return;
    window.API.video.getCategories().then((cats: unknown) => {
      const list = (Array.isArray(cats) ? cats : []) as Category[];
      const found = list.find((c) => String(c.id) === String(categoryId)) || null;
      setCategory(found);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : '加载分类失败');
    });
  }, [categoryId]);

  /** 搜索模式：按关键词 + 子分类搜索 */
  const searchVideos = useCallback(
    async (pageNum: number, subId: string, reset: boolean) => {
      if (!window.API?.video?.search || !searchKeyword.trim()) return;
      loadingRef.current = true;
      setLoading(true);
      setError('');
      // 子分类切换时立即清空旧内容，让用户看到加载状态而非停留的旧数据
      if (reset) {
        setVideos([]);
        videosLenRef.current = 0;
      }

      try {
        const options: Record<string, unknown> = { pg: pageNum, wd: searchKeyword };
        if (subId) {
          options.t = subId;
        }
        const response = await window.API.video.search(searchKeyword, options);
        const result = (response || {}) as Record<string, unknown>;
        const list = (result.list as Record<string, unknown>[]) || [];
        const total = (result.total as number) || 0;

        if (list.length === 0) {
          if (reset) {
            setVideos([]);
            videosLenRef.current = 0;
          }
          setHasMore(false);
          hasMoreRef.current = false;
          return;
        }

        const newItems = list.map(convertVideoToMediaItem);
        const prevLen = reset ? 0 : videosLenRef.current;
        const nextLen = prevLen + newItems.length;
        videosLenRef.current = nextLen;
        setVideos((prev) => (reset ? newItems : [...prev, ...newItems]));
        const nextHasMore = nextLen < total;
        setHasMore(nextHasMore);
        hasMoreRef.current = nextHasMore;
      } catch (err) {
        setError(err instanceof Error ? err.message : '搜索失败');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [searchKeyword]
  );

  /** 非搜索模式：选中子分类变化时重置并加载。
   *  首次有效运行时尝试从缓存恢复（从详情页返回场景），恢复后跳过加载；
   *  子分类切换时（非首次运行）不恢复，重置到顶部后重新加载。 */
  useEffect(() => {
    if (isSearchMode || !category) return;
    const subs = category.subcategories || [];
    const subIds = selectedSubs || subs.map((s) => s.id).join(',');
    if (!subIds) return;

    // 仅在首次有效运行时尝试从缓存恢复（从详情页返回）
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      const cached = listPageCache.get(getListCacheKey(categoryId, selectedSubs));
      if (cached) {
        setVideos(cached.videos);
        videosLenRef.current = cached.videos.length;
        pageRef.current = cached.page;
        setHasMore(cached.hasMore);
        hasMoreRef.current = cached.hasMore;
        // 同步更新 scrollYRef，避免 scroll 事件触发前 ref 为旧值
        scrollYRef.current = cached.scrollY;
        // 持续重试恢复滚动位置：缓存中的 videos 可能很多，
        // 浏览器需要多个帧才能完成布局，双 rAF 不足以确保 scrollTop 生效。
        // 重试直到位置匹配或超过上限（与 AppLayout 的 30×50ms 一致）。
        requestAnimationFrame(() => {
          let attempts = 0;
          const maxAttempts = 30;
          const tryRestore = () => {
            const container = getScrollContainer();
            if (container) {
              container.scrollTop = cached.scrollY;
              attempts++;
              if (Math.abs(container.scrollTop - cached.scrollY) > 5 && attempts < maxAttempts) {
                requestAnimationFrame(tryRestore);
              }
            }
          };
          tryRestore();
        });
        return;
      }
    }

    // 正常加载（首次无缓存或子分类切换）：重置到顶部
    const container = getScrollContainer();
    if (container) container.scrollTop = 0;
    pageRef.current = 1;
    setHasMore(true);
    hasMoreRef.current = true;
    loadVideos(1, subIds, true);
  }, [category, selectedSubs, loadVideos, isSearchMode, categoryId]);

  /** 搜索模式：关键词或子分类变化时重置并搜索 */
  useEffect(() => {
    if (!isSearchMode || !category) return;
    pageRef.current = 1;
    setHasMore(true);
    hasMoreRef.current = true;
    searchVideos(1, selectedSubs, true);
  }, [searchKeyword, selectedSubs, category, searchVideos, isSearchMode]);

  /** 滚动加载更多 */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    let isMounted = true;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!isMounted) return;
        entries.forEach((entry) => {
          if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
            const nextPage = pageRef.current + 1;
            pageRef.current = nextPage;
            if (isSearchMode) {
              searchVideos(nextPage, selectedSubs, false);
            } else {
              const subs = category?.subcategories || [];
              const subIds = selectedSubs || subs.map((s) => s.id).join(',');
              loadVideos(nextPage, subIds, false);
            }
          }
        });
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );

    observer.observe(sentinel);
    return () => {
      isMounted = false;
      observer.disconnect();
    };
  }, [category, selectedSubs, loadVideos, isSearchMode, searchVideos]);

  /**
   * 缓存保存：组件卸载（进入详情页）或 selectedSubs/categoryId 变化（切换子分类）时，
   * 将当前视频列表、分页、滚动位置写入缓存。
   * - 搜索模式不缓存（搜索结果易过期，且关键词可能变化）
   * - cleanup 读取 videosRef.current 和 scrollYRef.current（ref 镜像），
   *   避免闭包捕获旧 state，且规避 DOM 已被替换导致 container.scrollTop 失真
   */
  useEffect(() => {
    return () => {
      if (isSearchMode || !categoryId) return;
      listPageCache.set(getListCacheKey(categoryId, selectedSubs), {
        videos: videosRef.current,
        page: pageRef.current,
        hasMore: hasMoreRef.current,
        scrollY: scrollYRef.current,
      });
    };
  }, [categoryId, selectedSubs, isSearchMode]);

  /** 切换子分类 */
  const handleSubClick = (subId: string) => {
    setSearchParams({ category: subId });
    setSubDropdownOpen(false);
  };

  /** 点击"全部" */
  const handleAllClick = () => {
    setSearchParams({});
    setSubDropdownOpen(false);
  };

  if (!category) {
    return (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={`skeleton-${i}`} />
          ))}
        </div>
      </div>
    );
  }

  const subs = category.subcategories || [];
  const visibleSubs = subs.slice(0, VISIBLE_SUB_COUNT);
  const moreSubs = subs.slice(VISIBLE_SUB_COUNT);
  const isAllSelected = !selectedSubs;
  // 当前选中的子分类是否落在"更多"折叠区中：若是，"更多"按钮显示该项名称并高亮
  const activeInMore = moreSubs.find((s) => selectedSubs === String(s.id));

  return (
    <div>
      {/* 固定 header：左侧标题，右侧子分类折叠 */}
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pt-4 pb-4 mb-4 shadow-[0_4px_12px_-4px_hsl(var(--muted-foreground)/0.12)]">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* 左侧：分类标题 + 图标，搜索模式下显示搜索词 */}
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2 shrink-0">
            {isSearchMode ? (
              <>
                <SearchIcon className="w-5 h-5 text-brand" />
                <span>{searchKeyword}</span>
                <span className="text-sm font-normal text-muted-foreground">在{category.name}中搜索</span>
              </>
            ) : (
              <>
                {category.icon && (
                  <svg className="icon text-2xl" aria-hidden="true">
                    <use xlinkHref={`#${category.icon}`} />
                  </svg>
                )}
                {category.name}
              </>
            )}
          </h1>

          {/* 右侧：子分类按钮（前5个 + 更多折叠） */}
          {subs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleAllClick}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  isAllSelected
                    ? 'bg-brand text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                全部
              </button>
              {visibleSubs.map((sub) => {
                const active = selectedSubs === String(sub.id);
                return (
                  <button
                    key={sub.id}
                    onClick={() => handleSubClick(String(sub.id))}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                      active
                        ? 'bg-brand text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    )}
                  >
                    {sub.name}
                  </button>
                );
              })}
              {moreSubs.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setSubDropdownOpen(!subDropdownOpen)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
                      activeInMore
                        ? 'bg-brand text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    )}
                  >
                    {activeInMore ? activeInMore.name : '更多'}
                    <svg className="icon text-xs" aria-hidden="true">
                      <use xlinkHref="#icon-gengduo" />
                    </svg>
                  </button>
                  {subDropdownOpen && (
                    <div className="absolute right-0 top-full mt-2 z-20 bg-card rounded-xl shadow-card py-2 min-w-[120px] max-h-[240px] overflow-y-auto">
                      {moreSubs.map((sub) => {
                        const active = selectedSubs === String(sub.id);
                        return (
                          <button
                            key={sub.id}
                            onClick={() => handleSubClick(String(sub.id))}
                            className={cn(
                              'w-full text-left px-4 py-2 text-xs transition-colors',
                              active
                                ? 'text-brand font-medium bg-muted'
                                : 'text-foreground hover:bg-muted'
                            )}
                          >
                            {sub.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {/* 视频列表 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4">
        {videos.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            showFavorite
            favorite={isFavorite(item.id)}
            onFavoriteToggle={toggleFavorite}
          />
        ))}
      </div>

      {loading && (
        <div className={cn(
          'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4',
          videos.length > 0 && 'mt-4'
        )}>
          {/* 切换子分类（reset）时 videos 为空，显示更多骨架填充屏幕；加载更多时只显示 8 个 */}
          {Array.from({ length: videos.length > 0 ? 8 : 16 }).map((_, i) => (
            <SkeletonCard key={`skeleton-${i}`} />
          ))}
        </div>
      )}

      {!hasMore && videos.length > 0 && !loading && (
        <p className="mt-8 text-center text-sm text-muted-foreground">已加载全部内容</p>
      )}

      {!hasMore && videos.length === 0 && !error && !loading && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60">
          <div className="w-16 h-16 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
            <Film className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm">该分类下暂无内容</p>
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />
    </div>
  );
};

export default List;
