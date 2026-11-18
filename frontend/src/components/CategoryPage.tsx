import React, { useEffect, useRef, useState } from 'react';
import { MediaCard } from '@/components/MediaCard';
import { useFavorites } from '@/contexts/FavoritesContext';
import type { MediaItem } from '@/types';

interface CategoryPageProps {
  title: string;
  items: MediaItem[];
  pageSize?: number;
}

const PAGE_SIZE = 20;

const SkeletonCard: React.FC = () => (
  <div className="w-full animate-pulse">
    <div className="aspect-[2/3] w-full rounded-xl bg-muted" />
    <div className="mt-3 h-4 w-3/4 rounded bg-muted" />
    <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
  </div>
);

export const CategoryPage: React.FC<CategoryPageProps> = ({ title, items, pageSize = PAGE_SIZE }) => {
  const { toggleFavorite, isFavorite } = useFavorites();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleItems = items.slice(0, page * pageSize);
  const hasMore = visibleItems.length < items.length;

  useEffect(() => {
    setPage(1);
  }, [items]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && hasMore && !loading) {
            setLoading(true);
            window.setTimeout(() => {
              setPage((p) => p + 1);
              setLoading(false);
            }, 600);
          }
        });
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <h1 className="text-2xl font-bold text-foreground mb-6">{title}</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
        {visibleItems.map((item) => (
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 mt-4">
          {Array.from({ length: pageSize }).map((_, i) => (
            <SkeletonCard key={`skeleton-${i}`} />
          ))}
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <p className="mt-8 text-center text-sm text-muted-foreground">已加载全部内容</p>
      )}

      <div ref={sentinelRef} className="h-4" />
    </div>
  );
};
