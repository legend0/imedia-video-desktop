import React from 'react';
import { Heart } from 'lucide-react';
import { MediaCard } from '@/components/MediaCard';
import { useFavorites } from '@/contexts/FavoritesContext';

const SkeletonCard: React.FC = () => (
  <div className="w-full">
    <div className="shimmer aspect-[2/3] w-full rounded-xl" />
    <div className="shimmer mt-3 h-4 w-3/4 rounded" />
    <div className="shimmer mt-2 h-3 w-1/2 rounded" />
  </div>
);

const Favorites: React.FC = () => {
  const { favorites, loading, removeFavorite, isFavorite } = useFavorites();

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-orange flex items-center justify-center">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">我的收藏</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60 animate-in fade-in duration-300">
        <div className="w-16 h-16 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-muted-foreground/40" />
        </div>
        <p className="text-sm">暂无收藏内容</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-orange flex items-center justify-center">
          <Heart className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">我的收藏</h1>
        <span className="text-sm text-muted-foreground">共 {favorites.length} 个</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
        {favorites.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            showFavorite
            favorite={isFavorite(item.id)}
            onFavoriteToggle={(media) => removeFavorite(media.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default Favorites;
