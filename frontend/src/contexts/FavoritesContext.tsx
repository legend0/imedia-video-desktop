import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { MediaItem } from '@/types';
import {
  convertVideoToMediaItem,
  convertMediaItemToBackendVideo,
} from '@/utils/videoConvert';
import { useSound } from '@/contexts/SoundContext';

interface FavoritesContextType {
  favorites: MediaItem[];
  loading: boolean;
  isFavorite: (id: string) => boolean;
  addFavorite: (item: MediaItem) => void;
  removeFavorite: (id: string) => void;
  toggleFavorite: (item: MediaItem) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { play } = useSound();
  const [favorites, setFavorites] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!window.API) return;
    window.API.user.getFavorites().then((result) => {
      if (result.success && result.data) {
        // 后端存储的是 BackendVideo 结构，需转换为 MediaItem
        const list = (result.data as Record<string, unknown>[]).map(convertVideoToMediaItem);
        setFavorites(list);
      }
      setLoading(false);
    }).catch((err) => {
      console.warn('加载收藏列表失败:', err);
      setLoading(false);
    });
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.some((f) => f.id === id),
    [favorites]
  );

  const addFavorite = useCallback((item: MediaItem) => {
    setFavorites((prev) => (prev.some((f) => f.id === item.id) ? prev : [item, ...prev]));
    // 转换为后端期望的 Video 结构（带 videoId/vod_id 字段），避免后端识别失败
    const video = convertMediaItemToBackendVideo(item);
    window.API?.user.addToFavorites(video).catch((err) => {
      console.warn('添加收藏到后端失败:', err);
      // 回滚本地状态
      setFavorites((prev) => prev.filter((f) => f.id !== item.id));
    });
    // 播放收藏音效（仅添加时触发，与旧版 demo 行为一致）
    play('favorite');
  }, [play]);

  const removeFavorite = useCallback((id: string) => {
    const removed = favorites.find((f) => f.id === id);
    setFavorites((prev) => prev.filter((f) => f.id !== id));
    // 后端按 videoId 匹配，MediaItem.id 已等同于 videoId（见 convertMediaItemToBackendVideo）
    window.API?.user.removeFromFavorites(id).catch((err) => {
      console.warn('从后端移除收藏失败:', err);
      // 回滚本地状态
      if (removed) {
        setFavorites((prev) => (prev.some((f) => f.id === id) ? prev : [removed, ...prev]));
      }
    });
  }, [favorites]);

  const toggleFavorite = useCallback(
    (item: MediaItem) => {
      if (isFavorite(item.id)) {
        removeFavorite(item.id);
      } else {
        addFavorite(item);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  const value = useMemo<FavoritesContextType>(() => ({
    favorites,
    loading,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  }), [favorites, loading, isFavorite, addFavorite, removeFavorite, toggleFavorite]);

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = (): FavoritesContextType => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within FavoritesProvider');
  }
  return context;
};
