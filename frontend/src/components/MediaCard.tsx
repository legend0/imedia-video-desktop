import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageOff, Heart, Play, Download, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaItem } from '@/types';
import { formatRelativeTime } from '@/utils/format';
import { DownloadDialog } from '@/components/DownloadDialog';
import { LazyImage } from '@/components/LazyImage';

/** 类型语义色盘：根据影视类型返回对应的颜色类名，实现毫秒级辨识 */
function getTypeColor(type: string): { bg: string; text: string; ring: string } {
  const t = (type || '').toLowerCase();
  if (/科幻|sci-?fi|science/.test(t)) return { bg: 'bg-blue-500/90', text: 'text-white', ring: 'ring-blue-400/40' };
  if (/喜剧|comedy/.test(t)) return { bg: 'bg-orange-500/90', text: 'text-white', ring: 'ring-orange-400/40' };
  if (/动作|action/.test(t)) return { bg: 'bg-red-500/90', text: 'text-white', ring: 'ring-red-400/40' };
  if (/爱情|romance|romantic/.test(t)) return { bg: 'bg-pink-500/90', text: 'text-white', ring: 'ring-pink-400/40' };
  if (/恐怖|horror|惊悚|thriller/.test(t)) return { bg: 'bg-purple-600/90', text: 'text-white', ring: 'ring-purple-400/40' };
  if (/动画|anime|卡通/.test(t)) return { bg: 'bg-emerald-500/90', text: 'text-white', ring: 'ring-emerald-400/40' };
  if (/纪录|documentary|doc/.test(t)) return { bg: 'bg-amber-600/90', text: 'text-white', ring: 'ring-amber-400/40' };
  if (/悬疑|ystery|推理/.test(t)) return { bg: 'bg-indigo-500/90', text: 'text-white', ring: 'ring-indigo-400/40' };
  if (/综艺|variety|show/.test(t)) return { bg: 'bg-fuchsia-500/90', text: 'text-white', ring: 'ring-fuchsia-400/40' };
  if (/战争|war/.test(t)) return { bg: 'bg-stone-600/90', text: 'text-white', ring: 'ring-stone-400/40' };
  return { bg: 'bg-slate-600/90', text: 'text-white', ring: 'ring-slate-400/40' };
}

/** 判断画质金标：badge 含 4K/杜比/蓝光/原盘等关键词时使用金色样式 */
function isHighQualityBadge(badge: string): boolean {
  return /4k|8k|uhd|dolby|杜比|hdr|蓝光|原盘|remux|bluray/i.test(badge);
}

export interface MediaCardProps {
  item: MediaItem;
  meta?: string;
  showFavorite?: boolean;
  favorite?: boolean;
  onFavoriteToggle?: (item: MediaItem) => void;
  className?: string;
}

const MediaCardBase: React.FC<MediaCardProps> = ({
  item,
  meta,
  showFavorite,
  favorite,
  onFavoriteToggle,
  className,
}) => {
  const navigate = useNavigate();
  const [downloadOpen, setDownloadOpen] = useState(false);
  const formattedTime = useMemo(() => formatRelativeTime(item.updateTime), [item.updateTime]);
  // 不再将 type 加入 meta（已通过彩色 chip 单独展示）
  const displayMeta = meta ?? [item.year, item.region, formattedTime].filter(Boolean).join(' · ');
  const typeColor = useMemo(() => getTypeColor(item.type), [item.type]);
  const isGoldBadge = useMemo(() => isHighQualityBadge(item.badge || ''), [item.badge]);

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onFavoriteToggle?.(item);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDownloadOpen(true);
  };

  /**
   * 构造播放器所需的 videoData 并打开播放器窗口
   * @param playUrl - 已解析的 vod_play_url 字符串（来自 item 或 detail）
   * @param episodes - 已解析的剧集数组（当无 playUrl 时使用）
   */
  const openPlayer = useCallback(
    (playUrl?: string, episodes?: { title: string; url?: string }[]) => {
      const videoData: Record<string, unknown> = {
        title: item.title,
        vod_name: item.title,
        vod_id: item.id,
        videoId: item.id,
        id: item.id,
        vod_pic: item.cover,
        pic: item.cover,
        description: item.description,
        vod_play_url: playUrl,
        sourceKey: item.sourceKey,
      };
      if (!playUrl && episodes && episodes.length > 0) {
        videoData.episodes = episodes;
      }
      window.API?.player?.open(videoData);
    },
    [item]
  );

  /**
   * 播放按钮点击：
   * - item 自带 vod_play_url 或 episodes（来自收藏/历史）→ 直接打开播放器
   * - 否则调用 getVideoDetail 拉取详情后打开播放器
   * - 拉取失败时回退到详情页
   */
  const handlePlay = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const hasPlayUrl = !!item.vod_play_url;
      const hasEpisodes = !!item.episodes && item.episodes.some((ep) => !!ep.url);
      if (hasPlayUrl || hasEpisodes) {
        openPlayer(item.vod_play_url, item.episodes);
        return;
      }

      // 无播放数据时拉取详情
      try {
        const detail = (await window.API?.video?.getVideoDetail?.(item.id)) as
          | { vod_play_url?: string; vod_name?: string; vod_pic?: string }
          | undefined;
        if (detail && detail.vod_play_url) {
          openPlayer(detail.vod_play_url);
          return;
        }
      } catch {
        // 拉取失败，回退到详情页
      }
      navigate(`/detail/${item.id}`, { state: { item } });
    },
    [item, navigate, openPlayer]
  );

  return (
    <div
      onClick={() => navigate(`/detail/${item.id}`, { state: { item } })}
      className={cn(
        'group relative shrink-0 cursor-pointer rounded-xl overflow-hidden transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-hover',
        className
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-card bg-muted">
        {item.cover && !item.placeholder ? (
          <LazyImage
            src={item.cover}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/70">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/10">
              <ImageOff className="h-6 w-6 text-muted-foreground/60" />
            </div>
          </div>
        )}

        {/* 左上角画质金标：高画质用金色渐变+微光扫过，普通 badge 用半透明黑底 */}
        {item.badge && (
          <div
            className={cn(
              'absolute left-2 top-2 overflow-hidden rounded-md px-2 py-0.5 text-[11px] font-medium ring-1',
              isGoldBadge
                ? 'bg-gradient-to-br from-amber-400 to-yellow-600 text-black ring-amber-300/60 shadow-md'
                : 'bg-black/70 text-white ring-white/10'
            )}
          >
            {isGoldBadge && (
              <span
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                style={{ animation: 'gold-sweep 2.5s ease-in-out infinite' }}
              />
            )}
            <span className="relative">{item.badge}</span>
          </div>
        )}

        {item.rating && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-yellow-400">
            <Star className="h-3 w-3 fill-current" />
            {item.rating}
          </div>
        )}

        {/* 卡片底部信息区：类型彩色 chip + 标题 + meta */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 pt-12">
          {item.type && (
            <span
              className={cn(
                'mb-1.5 inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1',
                typeColor.bg,
                typeColor.text,
                typeColor.ring
              )}
            >
              <span className="truncate">{item.type}</span>
            </span>
          )}
          <h3 className="truncate text-sm font-semibold text-white" title={item.title}>
            {item.title}
          </h3>
          <p className="mt-0.5 truncate text-[11px] text-white/70">{displayMeta}</p>
        </div>

        {/* 悬浮遮罩：点击空白处进入详情页（由外层卡片 onClick 处理），点击播放按钮直接打开播放器 */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-all duration-300 group-hover:opacity-100">
          <button
            type="button"
            onClick={handlePlay}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="播放"
            className="flex h-14 w-14 translate-y-2 scale-90 items-center justify-center rounded-full bg-white/90 text-brand shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:scale-100 hover:bg-white"
          >
            <Play className="ml-0.5 h-6 w-6 fill-current" />
          </button>
        </div>

        {/* 右下角操作 */}
        <div className="absolute bottom-3 right-3 flex translate-y-2 gap-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            onClick={handleDownload}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition-colors hover:bg-white"
          >
            <Download className="h-4 w-4" />
          </button>
          {showFavorite && (
            <button
              onClick={handleFavorite}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full shadow-lg transition-colors',
                favorite
                  ? 'bg-brand text-white hover:bg-brand/90'
                  : 'bg-white/90 text-foreground hover:bg-brand hover:text-white'
              )}
            >
              <Heart className={cn('h-4 w-4', favorite && 'fill-current')} />
            </button>
          )}
        </div>
      </div>

      <DownloadDialog item={item} open={downloadOpen} onOpenChange={setDownloadOpen} />
    </div>
  );
};

/** memo 化：仅当 item/favorite/className 等 props 变化时才重渲染 */
export const MediaCard = React.memo(MediaCardBase);
