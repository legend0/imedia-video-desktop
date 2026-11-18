import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Download, AlertCircle, Search, X } from 'lucide-react';
import { useDownloads } from '@/contexts/DownloadsContext';
import type { MediaItem } from '@/types';

export interface DownloadDialogProps {
  item: MediaItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 解析后的下载剧集项 */
interface DownloadEpisode {
  title: string;
  url: string;
}

/**
 * 解析 vod_play_url 字符串为可下载的 m3u8 剧集列表
 * 格式：$$$ 分隔资源类型，# 分隔集数，$ 分隔标题和URL
 * @param playUrl - 原始播放地址字符串
 * @returns 可下载的 m3u8 剧集列表
 */
function parseDownloadEpisodes(playUrl: string | undefined): DownloadEpisode[] {
  if (!playUrl || typeof playUrl !== 'string') return [];
  const cleaned = playUrl.replace(/[<>`]/g, '');
  const firstLevel = cleaned.includes('$$$') ? cleaned.split('$$$') : [cleaned];
  const secondLevel = firstLevel.map((part) => (part.includes('#') ? part.split('#') : [part]));
  const episodes: DownloadEpisode[] = [];
  secondLevel.forEach((parts) => {
    parts.forEach((part) => {
      const splitPart = part.includes('$') ? part.split('$') : [part, ''];
      const title = splitPart[0]?.trim() || '';
      const url = splitPart[1]?.trim() || '';
      if (title && url) {
        const cleanUrl = url.toLowerCase().split('?')[0];
        if (cleanUrl.includes('.m3u8') || cleanUrl.includes('.m3u')) {
          episodes.push({ title, url });
        }
      }
    });
  });
  return episodes;
}

/**
 * 下载对话框组件：解析视频播放地址，支持单集直接下载和多集选择下载
 * 参考旧 demo 项目的 showDownloadDialog 逻辑
 */
export const DownloadDialog: React.FC<DownloadDialogProps> = ({ item, open, onOpenChange }) => {
  const { addTask, addBatchTasks } = useDownloads();
  const [loading, setLoading] = useState(false);
  const [episodes, setEpisodes] = useState<DownloadEpisode[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [noUrl, setNoUrl] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  /** 按搜索词筛选剧集，保留原始索引以便选中状态同步 */
  const filteredEpisodes = useMemo(() => {
    if (!searchQuery.trim()) return episodes.map((ep, idx) => ({ ep, idx }));
    const query = searchQuery.toLowerCase();
    return episodes
      .map((ep, idx) => ({ ep, idx }))
      .filter(({ ep }) => ep.title.toLowerCase().includes(query));
  }, [episodes, searchQuery]);

  /** 执行下载：单集用 addTask，多集用 addBatchTasks 批量提交 */
  const handleDownload = useCallback(
    (indices: Set<number>) => {
      if (!item || indices.size === 0) return;
      const paramsList = Array.from(indices).map((idx) => {
        const ep = episodes[idx];
        return {
          url: ep.url,
          fileName: `${item.title}${ep.title ? ` - ${ep.title}` : ''}`,
          thumbnail: item.cover,
          videoId: item.id,
          description: item.description,
          quality: item.badge,
          videoData: { title: item.title, cover: item.cover, episode: ep.title },
        };
      });
      if (paramsList.length === 1) {
        addTask(paramsList[0]);
      } else {
        addBatchTasks(paramsList);
      }
      onOpenChange(false);
    },
    [item, episodes, addTask, addBatchTasks, onOpenChange]
  );

  /** 用 ref 保存最新的 handleDownload，避免作为 useEffect 依赖导致死循环 */
  const handleDownloadRef = useRef(handleDownload);
  handleDownloadRef.current = handleDownload;

  /** 打开时加载剧集列表：优先使用 item.vod_play_url，否则获取详情 */
  useEffect(() => {
    if (!open || !item) return;
    setLoading(true);
    setEpisodes([]);
    setSelected(new Set());
    setNoUrl(false);
    setSearchQuery('');

    let cancelled = false;

    const loadEpisodes = async () => {
      let playUrl = item.vod_play_url;

      if (!playUrl && window.API?.video?.getVideoDetail) {
        try {
          const detail = await window.API.video.getVideoDetail(item.id);
          if (cancelled) return;
          playUrl = (detail as Record<string, unknown>)?.vod_play_url as string | undefined;
        } catch {
          // 获取详情失败，继续以空 playUrl 处理
        }
      }

      if (cancelled) return;

      const eps = parseDownloadEpisodes(playUrl);
      if (eps.length === 0) {
        setNoUrl(true);
        setLoading(false);
        return;
      }

      setEpisodes(eps);

      if (eps.length === 1) {
        // 单集直接下载：先关闭 loading 再触发下载，避免转圈残留
        setLoading(false);
        handleDownloadRef.current(new Set([0]));
        return;
      }

      setSelected(new Set([0]));
      setLoading(false);
    };

    loadEpisodes();
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  /** 全选/取消全选：仅操作当前筛选结果中的剧集 */
  const toggleAll = () => {
    const filteredIndices = filteredEpisodes.map(({ idx }) => idx);
    const allFilteredSelected =
      filteredIndices.length > 0 && filteredIndices.every((idx) => selected.has(idx));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredIndices.forEach((idx) => next.delete(idx));
      } else {
        filteredIndices.forEach((idx) => next.add(idx));
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[calc(100%-2rem)] md:max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>
            {item ? `选择下载 - ${item.title}` : '选择下载'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : noUrl ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <AlertCircle className="w-10 h-10 mb-3 text-orange" />
            <p className="text-sm">未找到可用的下载链接</p>
          </div>
        ) : (
          !loading &&
          episodes.length > 1 && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground shrink-0">
                  共 {filteredEpisodes.length} 集
                </span>
                <div className="relative flex-1 max-w-[200px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索剧集..."
                    className="w-full h-7 pl-7 pr-7 rounded-lg bg-muted text-sm outline-none focus:ring-1 focus:ring-brand"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <button
                  onClick={toggleAll}
                  className="text-sm text-brand hover:underline shrink-0"
                >
                  {filteredEpisodes.length > 0 && filteredEpisodes.every(({ idx }) => selected.has(idx))
                    ? '取消全选'
                    : '全选'}
                </button>
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-1">
                {filteredEpisodes.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    未找到匹配的剧集
                  </div>
                ) : (
                  filteredEpisodes.map(({ ep, idx }) => (
                    <label
                      key={idx}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selected.has(idx)}
                        onCheckedChange={() => toggleSelect(idx)}
                      />
                      <span className="text-sm flex-1 truncate">{ep.title}</span>
                    </label>
                  ))
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => handleDownload(selected)}
                  disabled={selected.size === 0}
                  className="gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  下载选中 ({selected.size})
                </Button>
              </DialogFooter>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
};
