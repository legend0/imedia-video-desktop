import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Tv, RefreshCw, Radio, Search, Inbox, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { LazyImage } from '@/components/LazyImage';

/** 全部分组标识（value 占位，代表不筛选） */
const ALL_GROUPS = '__all__';

/** 大屏断点（内容区宽度 ≥960px 时显示 5 列，否则 3 列） */
const GRID_BREAKPOINT = 960;

/**
 * 基于容器实际宽度计算网格列数
 * 使用 ResizeObserver 监听内容区宽度变化，确保响应式布局基于内容区而非视口
 * @returns [ref, columns] - ref 绑定到网格容器，columns 为当前列数
 */
function useGridColumns(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      setColumns(width >= GRID_BREAKPOINT ? 5 : 3);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, columns];
}

/**
 * 电视直播页面
 * 订阅更新后频道列表永久缓存于后端，直至下次手动更新
 */
const Live: React.FC = () => {
  const [channels, setChannels] = useState<IptvChannel[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_GROUPS);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [subUrl, setSubUrl] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [gridRef, gridColumns] = useGridColumns();

  /** 加载缓存的频道与分组 */
  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const [list, groupList, url, info] = await Promise.all([
        window.API?.iptv?.getChannels() ?? Promise.resolve([]),
        window.API?.iptv?.getGroups() ?? Promise.resolve([]),
        window.API?.iptv?.getSubscriptionUrl() ?? Promise.resolve(''),
        window.API?.iptv?.getCacheInfo() ?? Promise.resolve({ success: false, data: null }),
      ]);
      setChannels(list as IptvChannel[]);
      setGroups(groupList as string[]);
      setSubUrl(url as string);
      setUpdatedAt(info?.data?.updatedAt ?? null);
    } catch {
      toast.error('加载直播列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  /** 按分组与关键词过滤的频道列表 */
  const filteredChannels = useMemo(() => {
    let list = channels;
    if (selectedGroup !== ALL_GROUPS) {
      list = list.filter((c) => c.group === selectedGroup);
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((c) => c.name.toLowerCase().includes(kw));
    }
    return list;
  }, [channels, selectedGroup, keyword]);

  /** 点击频道卡片：打开播放器，剧集列表为全部频道（同分组），定位到当前频道 */
  const handlePlay = useCallback(
    (channel: IptvChannel) => {
      // 剧集列表使用当前过滤后的列表，便于在播放器中切换频道
      const episodes = filteredChannels.map((c) => ({ title: c.name, url: c.url }));
      const currentIndex = filteredChannels.findIndex((c) => c.url === channel.url);
      const videoData = {
        vod_name: '电视直播',
        title: channel.name,
        vod_id: `live_${channel.url}`,
        type: 'live' as const,
        episodes,
        currentEpisode: currentIndex >= 0 ? currentIndex : 0,
        vod_pic: channel.logo || '',
        sourceKey: 'live',
      };
      window.API?.player?.open(videoData).catch(() => {
        toast.error('播放失败，请稍后重试');
      });
    },
    [filteredChannels]
  );

  /** 订阅更新：拉取 → 解析 → 永久缓存 → 关闭弹窗 → 刷新列表 */
  const handleSubscribe = async () => {
    const url = subUrl.trim();
    if (!url) {
      toast.warning('请输入订阅地址');
      return;
    }
    setSubscribing(true);
    try {
      const result = await window.API?.iptv?.updateSubscription(url);
      if (result?.success) {
        toast.success(`订阅更新成功：${result.data?.count ?? 0} 个频道`);
        setDialogOpen(false);
        setSelectedGroup(ALL_GROUPS);
        await loadChannels();
      } else {
        toast.error(result?.error || '订阅地址无效，请检查后重试');
      }
    } catch {
      toast.error('订阅更新失败，请稍后重试');
    } finally {
      setSubscribing(false);
    }
  };

  const formatUpdateTime = (ts: number | null): string => {
    if (!ts) return '未更新';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div ref={gridRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* 顶部：标题 + 筛选 + 订阅按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Tv className="h-5 w-5 text-brand" />
            <h2 className="text-xl font-bold text-foreground">电视直播</h2>
          </div>
          <span className="mt-1 text-xs text-muted-foreground">
            共 {channels.length} 个频道 · 上次更新：{formatUpdateTime(updatedAt)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {groups.length > 0 && (
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder="选择分组" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_GROUPS}>全部分组</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {channels.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索频道"
                className="w-44 h-9 pl-8"
              />
            </div>
          )}

          <Button onClick={() => setDialogOpen(true)} variant="default" className="h-9 gap-1.5">
            <Radio className="h-4 w-4" />
            订阅
          </Button>
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <ChannelGridSkeleton columns={gridColumns} />
      ) : channels.length === 0 ? (
        <EmptyState onSubscribe={() => setDialogOpen(true)} />
      ) : filteredChannels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Inbox className="h-10 w-10 mb-3 opacity-50" />
          <p>当前筛选条件下无频道</p>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
        >
          {filteredChannels.map((channel) => (
            <ChannelCard key={`${channel.name}_${channel.url}`} channel={channel} onPlay={handlePlay} />
          ))}
        </div>
      )}

      {/* 订阅管理弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>直播订阅管理</DialogTitle>
            <DialogDescription>
              支持订阅 M3U8 直播源地址，地址若经过 Base64 编码将自动解码。更新后频道列表将永久缓存。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="sub-url" className="text-sm font-medium text-foreground">
              订阅地址
            </label>
            <Input
              id="sub-url"
              value={subUrl}
              onChange={(e) => setSubUrl(e.target.value)}
              placeholder="输入 M3U8 订阅地址"
              disabled={subscribing}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={subscribing}>
              关闭
            </Button>
            <Button onClick={handleSubscribe} disabled={subscribing} className="gap-1.5">
              {subscribing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  更新中...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  订阅更新
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** 频道卡片 */
const ChannelCard: React.FC<{ channel: IptvChannel; onPlay: (c: IptvChannel) => void }> = ({
  channel,
  onPlay,
}) => {
  return (
    <button
      onClick={() => onPlay(channel)}
      className="group relative flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-card"
      title={channel.name}
    >
      {/* 台标 */}
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
        <LazyImage
          src={channel.logo}
          alt={channel.name}
          className="h-full w-full object-contain p-1"
        />
      </div>
      {/* 名称 + 分组 */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{channel.name}</p>
        {channel.group && channel.group !== '未分组' && (
          <p className="truncate text-xs text-muted-foreground">{channel.group}</p>
        )}
      </div>
      {/* 播放图标 */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand opacity-0 transition-opacity group-hover:opacity-100">
        <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
    </button>
  );
};

/** 频道网格骨架屏 */
const ChannelGridSkeleton: React.FC<{ columns: number }> = ({ columns }) => (
  <div
    className="grid gap-3"
    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
  >
    {Array.from({ length: columns * 4 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
        <div className="shimmer h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <div className="shimmer h-3.5 w-3/4 rounded" />
          <div className="shimmer h-3 w-1/2 rounded" />
        </div>
      </div>
    ))}
  </div>
);

/** 空状态：引导用户订阅 */
const EmptyState: React.FC<{ onSubscribe: () => void }> = ({ onSubscribe }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand/10">
      <AlertCircle className="h-8 w-8 text-brand" />
    </div>
    <h3 className="text-lg font-semibold text-foreground">当前订阅无可用频道</h3>
    <p className="mt-1 text-sm text-muted-foreground">
      请点击「订阅」按钮，更新直播订阅地址以获取频道列表
    </p>
    <Button onClick={onSubscribe} className="mt-5 gap-1.5">
      <Radio className="h-4 w-4" />
      立即订阅
    </Button>
  </div>
);

export default Live;
