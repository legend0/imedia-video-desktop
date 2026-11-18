import React from 'react';
import { Play, Trash2, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LazyImage } from '@/components/LazyImage';
import { toast } from 'sonner';

export interface HistoryCardData {
  id: string;
  title: string;
  cover?: string;
  episodeText: string;
  durationText: string;
  progress: number;
  sourceKey?: string;
}

export interface HistoryCardProps {
  item: HistoryCardData;
  /**
   * 原始历史记录（含 url/currentEpisode/progress/episodes 等播放器所需全量字段）。
   * 点击卡片时直接传给 player.open 继续播放，避免跳转详情页导致信息不全。
   */
  rawHistory?: Record<string, unknown>;
  onDelete?: (item: HistoryCardData) => void;
  className?: string;
}

/** 格式化秒为 mm:ss 或 hh:mm:ss */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '未知时长';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 将后端历史记录转换为 HistoryCardData */
export function convertHistoryToCardData(item: Record<string, unknown>): HistoryCardData {
  // 历史记录中字段均在顶层（saveHistoryRecord 展开存储）；
  // 仅 detail/addToHistory 链路可能附带 video 子对象，故兼容读取
  const video = (item.video as Record<string, unknown>) || {};
  const episodeIndex = item.episodeIndex as number | undefined;
  const duration = (item.duration as number) || 0;
  const progress = (item.progress as number) || 0;
  const progressPercent = duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;

  // saveHistoryRecord 保证 videoId 存在；兼容读取 vod_id 与 id
  const sourceKey = (item.sourceKey as string) || (video.sourceKey as string) || 'default';

  // 直播记录：format 或 type 为 'live' 时，标题用频道名（title），集数显示"电视直播"
  const isLive = (item.format as string) === 'live' || (item.type as string) === 'live';

  return {
    id: String(item.videoId ?? item.id ?? video.vod_id ?? ''),
    title: isLive
      ? ((item.title as string) || (item.vod_name as string) || '')
      : ((item.vod_name as string) || (video.vod_name as string) || (item.title as string) || ''),
    cover: (item.pic as string) || (item.vod_pic as string) || (video.vod_pic as string),
    episodeText: isLive ? '电视直播' : (episodeIndex !== undefined ? `第${episodeIndex + 1}集` : '未分类'),
    durationText: duration ? formatDuration(duration) : '未知时长',
    progress: progressPercent,
    sourceKey,
  };
}

export const HistoryCard: React.FC<HistoryCardProps> = ({ item, rawHistory, onDelete, className }) => {
  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rawHistory) {
      toast.warning('历史记录数据缺失，无法播放');
      return;
    }
    // 校验是否有可播放的 URL 或剧集列表
    const hasUrl = !!(
      rawHistory.url ||
      (Array.isArray(rawHistory.episodes) && rawHistory.episodes.some((ep) => ep?.url))
    );
    if (!hasUrl) {
      toast.warning('该记录无播放地址，无法继续播放');
      return;
    }
    // 直接打开播放器继续播放，避免跳转详情页导致信息不全（切换源后尤甚）
    window.API?.player?.open(rawHistory).catch(() => {
      toast.error('播放失败，请稍后重试');
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(item);
  };

  return (
    <div
      onClick={handlePlay}
      className={cn(
        'group relative shrink-0 cursor-pointer overflow-hidden rounded-xl transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-hover',
        className
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted">
        {item.cover ? (
          <LazyImage
            src={item.cover}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/70">
            <ImageOff className="h-6 w-6 text-muted-foreground/60" />
          </div>
        )}

        {/* 底部信息渐变 + 标题 + 进度条（hover 时隐藏） */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pt-10 transition-opacity duration-300 group-hover:opacity-0">
          <h3 className="truncate text-sm font-medium text-white" title={item.title}>
            {item.title}
          </h3>
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/70">
            <span>{item.episodeText}</span>
            <span>{item.durationText}</span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-purple transition-[width] duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        </div>

        {/* 悬浮遮罩 */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-hover:opacity-100">
          <button
            onClick={handlePlay}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/90 text-white shadow-lg transition-transform duration-300 hover:scale-110 hover:bg-brand"
          >
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </button>
        </div>

        {/* 删除按钮 */}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 shadow-lg transition-all duration-300 hover:bg-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
