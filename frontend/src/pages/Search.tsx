import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Loader2 } from 'lucide-react';
import { MediaCard } from '@/components/MediaCard';
import { useFavorites } from '@/contexts/FavoritesContext';
import { convertVideoToMediaItem } from '@/utils/videoConvert';
import { toast } from 'sonner';
import type { MediaItem } from '@/types';

const Search: React.FC = () => {
  const [searchParams] = useSearchParams();
  const keyword = searchParams.get('q') || '';
  const { isFavorite, toggleFavorite } = useFavorites();

  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const pageRef = useRef(1);
  const resultsLenRef = useRef(0);
  const loaderRef = useRef<HTMLDivElement>(null);

  /** 按关键词执行搜索 */
  useEffect(() => {
    if (!window.API || !keyword.trim()) return;

    let cancelled = false;
    setResults([]);
    resultsLenRef.current = 0;
    setTotal(0);
    setHasMore(false);
    pageRef.current = 1;
    setLoading(true);

    window.API.video
      .search(keyword, { pg: 1, wd: keyword })
      .then((result: unknown) => {
        if (cancelled) return;
        const resp = result as Record<string, unknown>;
        const list = (resp?.list || []) as Record<string, unknown>[];
        const newItems = list.map(convertVideoToMediaItem);
        setResults(newItems);
        resultsLenRef.current = newItems.length;
        const totalCount = (resp?.total as number) || 0;
        setTotal(totalCount);
        setHasMore(newItems.length < totalCount);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('搜索失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [keyword]);

  const loadMore = useCallback(() => {
    if (!window.API || loading || !hasMore) return;
    setLoading(true);
    const nextPage = pageRef.current + 1;

    window.API.video
      .search(keyword, { pg: nextPage, wd: keyword })
      .then((result: unknown) => {
        const resp = result as Record<string, unknown>;
        const list = (resp?.list || []) as Record<string, unknown>[];
        const newItems = list.map(convertVideoToMediaItem);
        const totalCount = (resp?.total as number) || 0;
        // 在 setResults 外部计算，避免在 updater 函数内产生副作用
        const combinedLen = resultsLenRef.current + newItems.length;
        setResults((prev) => [...prev, ...newItems]);
        resultsLenRef.current = combinedLen;
        setHasMore(combinedLen < totalCount);
        pageRef.current = nextPage;
      })
      .catch(() => {
        toast.error('加载更多失败');
      })
      .finally(() => setLoading(false));
  }, [keyword, loading, hasMore]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Sticky header：标题 */}
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pt-4 pb-3 mb-2 shadow-[0_4px_12px_-4px_hsl(var(--muted-foreground)/0.12)]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-orange flex items-center justify-center">
            <SearchIcon className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">搜索结果</h1>
          {keyword && (
            <span className="text-sm text-muted-foreground">
              关键词：<span className="text-foreground font-medium">{keyword}</span>
            </span>
          )}
          {total > 0 && <span className="text-sm text-muted-foreground">找到 {total} 个结果</span>}
        </div>
      </div>

      {loading && results.length === 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="w-full">
              <div className="shimmer aspect-[2/3] w-full rounded-xl" />
              <div className="shimmer mt-3 h-4 w-3/4 rounded" />
              <div className="shimmer mt-2 h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60">
          <div className="w-16 h-16 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
            <SearchIcon className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm">
            {keyword.trim() ? '暂无相关内容' : '请输入搜索关键词'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {results.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                showFavorite
                favorite={isFavorite(item.id)}
                onFavoriteToggle={toggleFavorite}
              />
            ))}
          </div>
          {hasMore && (
            <div ref={loaderRef} className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Search;
