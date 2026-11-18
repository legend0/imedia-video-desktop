import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Play, Heart, Download, ChevronDown, ChevronUp, User, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaItem } from '@/types';
import { useFavorites } from '@/contexts/FavoritesContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { LazyImage } from '@/components/LazyImage';
import { DownloadDialog } from '@/components/DownloadDialog';
import { useDragScroll } from '@/hooks/use-drag-scroll';
import { Segment, useDefault } from 'segmentit';

/** 默认推荐条数（系统设置未配置时的兜底） */
const DEFAULT_RECOMMEND_COUNT = 8;
/** 单卡片宽度（与首页 MediaRow 保持一致） */
const RECOMMEND_CARD_WIDTH = 160;
/** 卡片间距（与首页 MediaRow 保持一致） */
const RECOMMEND_SECTION_GAP = 24;

/** segmentit 单例：词典加载成本高，全局复用 */
const segmentInstance = useDefault(new Segment());

/** 播放源类型 */
type SourceType = 'm3u8' | 'mp4' | 'iframe';

/** 解析后的剧集项 */
interface EpisodeItem {
  title: string;
  url: string;
  type: SourceType;
}

/** 解析后的播放地址（按源类型分组） */
interface ParsedPlayUrls {
  m3u8: EpisodeItem[];
  mp4: EpisodeItem[];
  iframe: EpisodeItem[];
}

/** 后端视频详情对象（getVideoDetail 返回） */
interface VideoDetail {
  vod_id?: string;
  vod_name?: string;
  vod_sub?: string;
  vod_pic?: string;
  vod_content?: string;
  vod_play_url?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_year?: string;
  vod_lang?: string;
  vod_area?: string;
  type_name?: string;
  type_id_1?: string;
  vod_remarks?: string;
  vod_score?: string;
  vod_pubdate?: string;
  vod_hits?: string | number;
  vod_duration?: string;
  vod_writer?: string;
  vod_total?: number;
  vod_score_num?: number;
  vod_up?: number;
  vod_down?: number;
  vod_douban_id?: string;
  vod_douban_score?: string;
  vod_version?: string;
  vod_state?: string;
}

/** 推荐视频项（search 返回的列表项） */
interface RecommendVideo {
  vod_id?: string;
  id?: string;
  vod_name?: string;
  vod_pic?: string;
  vod_remarks?: string;
  type_name?: string;
  vod_year?: string;
}

/** TMDB 媒体信息（mediainfo 返回的 data） */
interface MediaInfo {
  poster?: string;
  backdrop?: string;
  actorDetails?: { name?: string; avatar?: string }[];
  photos?: { url?: string; alt?: string }[];
  reviews?: { reviewer?: string; avatar?: string; date?: string; rating?: number; content?: string }[];
  type?: string;
  genres?: string[];
  region?: string;
  year?: string;
  language?: string;
  duration?: string;
  status?: string;
  rating?: number;
  synopsis?: string;
  director?: string;
}

/** 源类型显示名称映射 */
const SOURCE_TYPE_NAMES: Record<SourceType, string> = {
  m3u8: '高清',
  mp4: '标清',
  iframe: '网页',
};

/**
 * 根据URL判断播放源类型
 * @param url - 播放地址
 * @returns 源类型（m3u8/mp4/iframe）
 */
function determineUrlType(url: string): SourceType {
  if (!url) return 'iframe';
  const cleanUrl = url.toLowerCase().split('?')[0];
  if (cleanUrl.includes('.m3u8') || cleanUrl.includes('.m3u')) return 'm3u8';
  if (
    cleanUrl.includes('.mp4') ||
    cleanUrl.includes('.webm') ||
    cleanUrl.includes('.avi') ||
    cleanUrl.includes('.mov') ||
    cleanUrl.includes('.mkv') ||
    cleanUrl.includes('.flv')
  ) {
    return 'mp4';
  }
  if (cleanUrl.includes('rtmp://') || cleanUrl.includes('rtsp://')) return 'mp4';
  return 'iframe';
}

/**
 * 解析 vod_play_url 字符串为按源类型分组的剧集列表
 * 格式：$$$ 分隔资源类型，# 分隔集数，$ 分隔标题和URL
 * @param playUrl - 原始播放地址字符串
 * @returns 按源类型分组的剧集列表
 */
function parsePlayUrl(playUrl: string | undefined): ParsedPlayUrls {
  const empty: ParsedPlayUrls = { m3u8: [], mp4: [], iframe: [] };
  if (!playUrl || typeof playUrl !== 'string') return empty;

  const cleaned = playUrl.replace(/[<>`]/g, '');
  const firstLevel = cleaned.includes('$$$') ? cleaned.split('$$$') : [cleaned];
  const secondLevel = firstLevel.map((part) => (part.includes('#') ? part.split('#') : [part]));

  const result: ParsedPlayUrls = { m3u8: [], mp4: [], iframe: [] };
  secondLevel.forEach((parts) => {
    parts.forEach((part) => {
      const splitPart = part.includes('$') ? part.split('$') : [part, ''];
      const title = splitPart[0]?.trim() || '';
      const url = splitPart[1]?.trim() || '';
      if (title && url) {
        const urlType = determineUrlType(url);
        result[urlType].push({ title, url, type: urlType });
      }
    });
  });

  return result;
}

/**
 * 获取视频标题（去除括号等多余信息），用于推荐搜索
 * @param title - 原始标题
 * @returns 处理后的标题
 */
function getCleanTitle(title: string | undefined): string {
  if (!title) return '';
  return title.replace(/[\[\(].*?[\]\)]/g, '').trim();
}

/**
 * 推荐视频横滑行：复用 useDragScroll，布局对齐首页 MediaRow
 * @param videos - 推荐视频列表
 * @param onCardClick - 卡片点击回调
 */
const RecommendRow: React.FC<{
  videos: RecommendVideo[];
  onCardClick: (videoId: string | undefined) => void;
}> = ({ videos, onCardClick }) => {
  const [scrollRef, isDragging] = useDragScroll<HTMLDivElement>();
  const rowWidth = useMemo(
    () => videos.length * RECOMMEND_CARD_WIDTH + (videos.length - 1) * RECOMMEND_SECTION_GAP,
    [videos.length]
  );

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex gap-6 overflow-x-auto pb-4 select-none scrollbar-hide',
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      style={{ minWidth: 0 }}
    >
      <div className="flex gap-6" style={{ minWidth: rowWidth, paddingRight: 24 }}>
        {videos.map((video, idx) => {
          const videoId = video.vod_id || video.id || '';
          return (
            <button
              key={videoId || idx}
              onClick={() => onCardClick(videoId)}
              className="group flex w-40 shrink-0 flex-col gap-2 text-left"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted shadow-card transition-transform group-hover:scale-105">
                {video.vod_pic ? (
                  <LazyImage
                    src={video.vod_pic}
                    alt={video.vod_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <User className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
              </div>
              <span className="line-clamp-1 text-xs text-foreground">{video.vod_name}</span>
              {video.vod_remarks && (
                <span className="text-xs text-muted-foreground">{video.vod_remarks}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const Detail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [mockItem, setMockItem] = useState<MediaItem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recommendVideos, setRecommendVideos] = useState<RecommendVideo[]>([]);
  /** 当前源是否支持搜索（不支持则不显示"猜你喜欢"模块） */
  const [sourceCanSearch, setSourceCanSearch] = useState(true);
  /** 推荐条数上限（读取系统设置 ui.homeCategoryCount，未配置时使用默认值） */
  const recommendCount = useRef<number>(DEFAULT_RECOMMEND_COUNT);
  /** 上次已加载推荐的 id，避免 detail/mockItem 顺序到达时重复触发加载导致闪烁 */
  const lastLoadedIdRef = useRef<string>('');
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);

  const [expanded, setExpanded] = useState(false);
  const [expandedEpisodes, setExpandedEpisodes] = useState(false);
  const [showEpisodesExpandBtn, setShowEpisodesExpandBtn] = useState(false);
  const [activeSourceType, setActiveSourceType] = useState<SourceType>('m3u8');
  const [selectedEpisode, setSelectedEpisode] = useState(0);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);
  const episodesContainerRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);

  /**
   * 加载视频详情：
   * - 从收藏/历史导航过来且携带了完整播放数据（vod_play_url 或 episodes）时，
   *   直接使用保存的数据，跳过 API 获取，避免切换源后 API 返回不存在/不一致的数据；
   *   行为对齐 demo 详情页（demo/js/pages/detail/index.js:110-116）。
   * - 其他情况（从首页/搜索/推荐进入，或收藏数据不含播放地址）走 API 获取。
   */
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    // 直接读取路由 state，避免与 mockItem 状态的闭包竞态
    const stateItem = (location.state as { item?: MediaItem } | null)?.item;
    // 同步 mockItem 状态（切换 id 时若没有 state.item 则清空，防止上一条记录泄漏）
    setMockItem(stateItem || undefined);

    const hasPlayData = !!stateItem && (
      !!stateItem.vod_play_url ||
      (!!stateItem.episodes && stateItem.episodes.some((ep) => !!ep.url))
    );

    if (hasPlayData) {
      // 已有完整播放数据，无需再请求当前源 API（防止切换源后数据错乱）
      setLoading(false);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    const loadDetail = async () => {
      if (window.API?.video?.getVideoDetail) {
        try {
          const result = await window.API.video.getVideoDetail(id);
          if (cancelled) return;
          const videoData = result as VideoDetail;
          if (videoData && videoData.vod_id) {
            setDetail(videoData);
            setLoading(false);
            return;
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '加载视频详情失败');
          }
        }
      }
      if (cancelled) return;
      setLoading(false);
    };

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [id, location.state]);

  /** 解析剧集列表：优先 detail.vod_play_url，其次 mockItem 全量数据（切换源后回退） */
  const parsedPlayUrls = useMemo<ParsedPlayUrls>(() => {
    if (detail?.vod_play_url) return parsePlayUrl(detail.vod_play_url);
    // 回退 1：收藏/历史保存的 vod_play_url 原始字符串
    if (mockItem?.vod_play_url) return parsePlayUrl(mockItem.vod_play_url);
    // 回退 2：收藏/历史保存的 episodes 数组，按 URL 后缀分类
    if (mockItem?.episodes) {
      const result: ParsedPlayUrls = { m3u8: [], mp4: [], iframe: [] };
      mockItem.episodes
        .filter((ep) => ep.url)
        .forEach((ep) => {
          const url = ep.url as string;
          const urlType = determineUrlType(url);
          result[urlType].push({ title: ep.label, url, type: urlType });
        });
      return result;
    }
    return { m3u8: [], mp4: [], iframe: [] };
  }, [detail, mockItem]);

  /** 可用源类型列表（过滤空源） */
  const availableSourceTypes = useMemo<SourceType[]>(() => {
    const types: SourceType[] = ['m3u8', 'mp4', 'iframe'];
    return types.filter((type) => parsedPlayUrls[type].length > 0);
  }, [parsedPlayUrls]);

  /** 当前激活源类型的剧集 */
  const currentEpisodes = useMemo<EpisodeItem[]>(() => {
    return parsedPlayUrls[activeSourceType] || [];
  }, [parsedPlayUrls, activeSourceType]);

  /** 可用源变化时，确保 activeSourceType 有效 */
  useEffect(() => {
    if (availableSourceTypes.length > 0 && !availableSourceTypes.includes(activeSourceType)) {
      setActiveSourceType(availableSourceTypes[0]);
    }
  }, [availableSourceTypes]);

  /** 源类型切换时重置选中集数 */
  useEffect(() => {
    setSelectedEpisode(0);
  }, [activeSourceType]);

  /** 检测剧集列表容器高度，超过 200px 时显示展开按钮 */
  useEffect(() => {
    if (!episodesContainerRef.current) return;
    const checkHeight = () => {
      const el = episodesContainerRef.current;
      if (!el) return;
      // scrollHeight 返回内容完整高度（不受 max-height 影响），无需修改 style
      // 避免在 transition-all duration-300 元素上反复改 maxHeight 触发 ResizeObserver 循环
      setShowEpisodesExpandBtn(el.scrollHeight > 200);
    };
    checkHeight();
    const resizeObserver = new ResizeObserver(checkHeight);
    resizeObserver.observe(episodesContainerRef.current);
    return () => resizeObserver.disconnect();
  }, [currentEpisodes, activeSourceType]);

  /** 加载推荐视频（依赖 detail.vod_name 或 mockItem.title 兜底） */
  useEffect(() => {
    const recommendTitle = detail?.vod_name || mockItem?.title || '';
    if (!recommendTitle) return;
    if (!window.API?.video?.search) return;
    // 同 id 只加载一次：避免 detail 与 mockItem 顺序到达时（title 可能略有差异）重复触发导致列表闪烁
    if (lastLoadedIdRef.current === id) return;
    lastLoadedIdRef.current = id;
    let cancelled = false;

    const loadRecommend = async () => {
      try {
        // 1. 检查当前源是否支持搜索，不支持则隐藏"猜你喜欢"模块
        // 注：source.search 为 undefined 时视为支持（与 sourceManager 默认行为一致）
        const currentSource = await window.API?.source?.getCurrentSource?.();
        if (cancelled) return;
        if (!currentSource || currentSource.search === false) {
          setSourceCanSearch(false);
          setRecommendVideos([]);
          return;
        }
        setSourceCanSearch(true);

        // 2. 读取系统设置中的"首页分类显示条数"作为推荐总条数上限
        const configuredCount = await window.API?.settings?.get?.('ui.homeCategoryCount');
        if (cancelled) return;
        const limit = typeof configuredCount === 'number' && configuredCount >= 4 && configuredCount <= 20
          ? configuredCount
          : DEFAULT_RECOMMEND_COUNT;
        recommendCount.current = limit;

        const searchName = getCleanTitle(recommendTitle);
        if (!searchName) return;

        // 3. 精准查找（保留原逻辑）：用清洗后的全名搜索
        const exactResult = await window.API?.video.search(searchName);
        if (cancelled) return;
        const exactList = ((exactResult || {}) as { list?: RecommendVideo[] }).list || [];
        // 排除当前详情页：detail.vod_id（API 返回）→ mockItem.id（收藏/历史）→ URL id
        const currentId = String(detail?.vod_id || mockItem?.id || id || '');
        // seenIds 同时记录 vod_id 和 id，避免 A.vod_id === B.id 时漏过导致 React key 重复
        const seenIds = new Set<string>();
        const isCurrentOrDup = (v: RecommendVideo): boolean => {
          const vodId = v.vod_id !== undefined ? String(v.vod_id) : '';
          const vid = v.id !== undefined ? String(v.id) : '';
          if (!vodId && !vid) return true;
          if (currentId && (vodId === currentId || vid === currentId)) return true;
          if (vodId && seenIds.has(vodId)) return true;
          if (vid && seenIds.has(vid)) return true;
          if (vodId) seenIds.add(vodId);
          if (vid) seenIds.add(vid);
          return false;
        };
        const merged: RecommendVideo[] = [];
        for (const v of exactList) {
          if (isCurrentOrDup(v)) continue;
          merged.push(v);
          if (merged.length >= limit) break;
        }

        // 4. 不足部分用分词查找补齐
        if (merged.length < limit) {
          const tokens = (segmentInstance.doSegment(searchName, {
            simple: true,
            stripPunctuation: true,
            stripStopword: true,
          }) as string[]).filter((w) => w && w.length >= 2 && w !== searchName);
          // 去重关键词顺序，避免重复搜索
          const uniqueTokens = Array.from(new Set(tokens));
          for (const token of uniqueTokens) {
            if (merged.length >= limit) break;
            if (cancelled) return;
            try {
              const tokenResult = await window.API.video.search(token);
              if (cancelled) return;
              const tokenList = ((tokenResult || {}) as { list?: RecommendVideo[] }).list || [];
              for (const v of tokenList) {
                if (isCurrentOrDup(v)) continue;
                merged.push(v);
                if (merged.length >= limit) break;
              }
            } catch {
              if (cancelled) return;
              // 单个分词搜索失败不阻塞，继续下一个
            }
          }
        }

        if (!cancelled) {
          setRecommendVideos(merged);
        }
      } catch (err) {
        // 推荐加载失败不阻塞页面，仅记录日志
        console.warn('加载推荐视频失败:', err);
      }
    };

    loadRecommend();
    return () => {
      cancelled = true;
    };
  }, [detail, mockItem, id]);

  /** 加载 TMDB 媒体信息（依赖 detail.vod_name） */
  useEffect(() => {
    if (!detail?.vod_name) return;
    if (!window.API?.video?.mediainfo) return;
    let cancelled = false;

    const loadMediaInfo = async () => {
      try {
        const isTv = parsedPlayUrls.m3u8.length > 1;
        const result = await window.API.video.mediainfo(detail.vod_name, {
          year: detail.vod_year || '',
          isTv,
          includePhotos: true,
        });
        if (cancelled) return;
        const mediaResult = (result || {}) as { success?: boolean; data?: MediaInfo };
        if (mediaResult.success && mediaResult.data) {
          setMediaInfo(mediaResult.data);
        }
      } catch (err) {
        // TMDB 加载失败不阻塞页面，仅记录日志
        console.warn('加载TMDB信息失败:', err);
      }
    };

    loadMediaInfo();
    return () => {
      cancelled = true;
    };
  }, [detail, parsedPlayUrls]);

  // 统一字段：description（需在条件 return 之前定义，供 useEffect 依赖）
  const description =
    (detail?.vod_content || '').replace(/<[^>]*>/g, '') ||
    mockItem?.description ||
    mediaInfo?.synopsis ||
    '';

  /** 检测简介是否超出 3 行（仅在折叠状态下检测） */
  useEffect(() => {
    if (expanded) return;
    const el = descriptionRef.current;
    if (!el) return;
    const checkOverflow = () => {
      setDescriptionOverflows(el.scrollHeight > el.clientHeight + 2);
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [description, expanded]);

  // 统一字段：优先 detail，其次 mockItem，最后 mediaInfo（memo 化避免每次渲染重算）
  // 必须在条件 return 之前调用，否则违反 React Hooks 规则
  const { title, subtitle, cover, background, rating, badge, typeName, year, region, language, director, updateTime, actorList, actorDetails } = useMemo(() => {
    const c = detail?.vod_pic || mockItem?.cover || mediaInfo?.poster || '';
    const actors = (detail?.vod_actor || '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    return {
      title: detail?.vod_name || mockItem?.title || '',
      subtitle: detail?.vod_sub || mockItem?.originalName || '',
      cover: c,
      background: c || '',
      rating: detail?.vod_score || mockItem?.rating || (mediaInfo?.rating ? mediaInfo.rating.toFixed(1) : ''),
      badge: detail?.vod_remarks || mockItem?.badge || '',
      typeName: detail?.type_name || mockItem?.type || mediaInfo?.type || '',
      year: detail?.vod_year || mockItem?.year || mediaInfo?.year || '',
      region: detail?.vod_area || mockItem?.region || mediaInfo?.region || '',
      language: detail?.vod_lang || mockItem?.language || mediaInfo?.language || '',
      director: detail?.vod_director || mockItem?.director || mediaInfo?.director || '',
      updateTime: mockItem?.updateTime || detail?.vod_pubdate || '',
      actorList: actors.length > 0 ? actors.map((name) => ({ name })) : mockItem?.actors || [],
      actorDetails: mediaInfo?.actorDetails || [],
    };
  }, [detail, mockItem, mediaInfo]);

  /** 构造下载对话框所需的 MediaItem（detail 为 null 时回退到 mockItem 的播放地址） */
  const downloadItem = useMemo<MediaItem | null>(() => {
    if (!detail && !mockItem) return null;
    return {
      id: detail?.vod_id || id || '',
      title,
      badge,
      type: typeName,
      year,
      region,
      updateTime,
      cover,
      description,
      vod_play_url: detail?.vod_play_url || mockItem?.vod_play_url,
    };
  }, [detail, mockItem, id, title, badge, typeName, year, region, updateTime, cover, description]);

  const favorite = id ? isFavorite(id) : false;

  if (!loading && !detail && !mockItem) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <p>{error || '未找到该影视内容'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="-m-6 min-h-[calc(100vh-4rem)] overflow-x-hidden">
        {/* 背景区域骨架 */}
        <div className="relative w-full overflow-hidden">
          <div className="absolute inset-0 bg-muted/40" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />
          <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
            <div className="flex flex-col gap-8 md:flex-row md:items-start">
              {/* 海报骨架 */}
              <div className="shrink-0">
                <div className="w-40 aspect-[2/3] rounded-xl bg-muted animate-pulse md:w-52" />
              </div>
              {/* 信息区骨架 */}
              <div className="flex-1 min-w-0 space-y-5">
                <div className="space-y-2">
                  <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                  <div className="flex gap-2">
                    <div className="h-5 w-12 rounded bg-muted animate-pulse" />
                    <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                    <div className="h-5 w-14 rounded bg-muted animate-pulse" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="h-9 w-20 rounded-full bg-muted animate-pulse" />
                  <div className="h-9 w-20 rounded-full bg-muted animate-pulse" />
                  <div className="h-9 w-20 rounded-full bg-muted animate-pulse" />
                </div>
                <div className="flex gap-6">
                  <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                </div>
                <div className="space-y-2 max-w-3xl">
                  <div className="h-3 w-full rounded bg-muted animate-pulse" />
                  <div className="h-3 w-full rounded bg-muted animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* 剧集列表骨架 */}
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="h-6 w-24 rounded bg-muted animate-pulse mb-4" />
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 w-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        </div>
        {/* 猜你喜欢骨架 */}
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="h-6 w-24 rounded bg-muted animate-pulse mb-4" />
          <div className="flex gap-6 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-40 shrink-0">
                <div className="aspect-[2/3] w-full rounded-xl bg-muted animate-pulse" />
                <div className="mt-2 h-3 w-full rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const handleFavorite = () => {
    if (!id) return;
    // 构建包含全量播放数据的 MediaItem，以便切换源后仍可播放
    // 当 detail 存在时（API 拉取成功）优先用 detail 的数据；否则回退到 mockItem
    const favItem: MediaItem = mockItem || {
      id,
      title,
      cover,
      badge,
      type: typeName,
      year,
      region,
      updateTime,
      rating: rating || undefined,
      vod_play_url: detail?.vod_play_url,
      episodes: currentEpisodes.length > 0
        ? currentEpisodes.map((ep) => ({ label: ep.title, url: ep.url }))
        : undefined,
    };
    toggleFavorite(favItem);
    toast.success(favorite ? '已取消收藏' : '已加入收藏');
  };

  const handleDownload = () => {
    // 同时检查 detail 和 mockItem 的播放地址，跳过 API 时 detail 可能为 null
    if (!detail?.vod_play_url && !mockItem?.vod_play_url) {
      toast.warning('暂无可下载的剧集');
      return;
    }
    setDownloadOpen(true);
  };

  const handlePlay = () => {
    playEpisode(selectedEpisode);
  };

  /**
   * 播放指定剧集
   * @param episodeIndex - 剧集索引
   */
  const playEpisode = async (episodeIndex: number) => {
    if (currentEpisodes.length === 0) {
      toast.warning('暂无播放链接');
      return;
    }
    const safeIndex = Math.max(0, Math.min(episodeIndex, currentEpisodes.length - 1));
    const ep = currentEpisodes[safeIndex] || currentEpisodes[0];
    const videoId = detail?.vod_id || id;
    // 跳过 API 时 detail 为 null，需回退到 mockItem 的播放数据，确保历史记录保存全量数据
    const playUrl = detail?.vod_play_url || mockItem?.vod_play_url;
    const videoData = {
      title,
      vod_id: videoId,        // 后端 userMedia 识别用
      videoId,                // 兼容字段
      vod_name: title,
      vod_pic: cover,
      pic: cover,
      description,
      vod_play_url: playUrl,  // 保留原始播放地址，切换源后仍可解析剧集
      episodes: currentEpisodes.map((e) => ({ title: e.title, url: e.url })),
      currentEpisode: safeIndex,
      episodeIndex: safeIndex,
      url: ep.url,
      type: ep.type,
      sourceKey: mockItem?.sourceKey || (await window.API?.source?.getCurrentSource?.())?.key || 'default',
    };
    window.API?.player.open(videoData);
    // 写入播放历史（后端会按 videoId 去重更新）
    window.API?.user.addToHistory(videoData).catch(() => {});
    toast.info(`开始播放：${title} - ${ep.title}`);
  };

  /**
   * 点击剧集列表中的某一集
   * @param idx - 剧集索引
   */
  const handleEpisodeClick = (idx: number) => {
    setSelectedEpisode(idx);
    playEpisode(idx);
  };

  const handleRecommendClick = (videoId: string | undefined) => {
    if (!videoId) return;
    navigate(`/detail/${videoId}`);
  };

  // 仅一个播放源且仅一集时，无需展示剧集列表
  const isSingleSourceSingleEpisode = availableSourceTypes.length === 1 && currentEpisodes.length === 1;
  const showEpisodesSection =
    availableSourceTypes.length > 0 && currentEpisodes.length > 0 && !isSingleSourceSingleEpisode;

  return (
    <div className="-m-6 min-h-[calc(100vh-4rem)] overflow-x-hidden">
      {/* 背景区域 */}
      <div className="relative w-full overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center scale-110"
          style={{ backgroundImage: `url(${background})`, filter: 'blur(20px)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col gap-8 md:flex-row md:items-start">
            {/* 海报 */}
            <div className="shrink-0">
              <div className="w-40 overflow-hidden rounded-xl shadow-card md:w-52">
                {cover && !mockItem?.placeholder ? (
                  <img src={cover} alt={title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-muted">
                    <User className="h-12 w-12 text-muted-foreground/40" />
                  </div>
                )}
              </div>
            </div>

            {/* 信息区 */}
            <div className="flex-1 min-w-0 space-y-5">
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-foreground md:text-3xl">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {rating && (
                    <span className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                      <Star className="h-3 w-3 fill-current" /> {rating}
                    </span>
                  )}
                  {badge && (
                    <span className="rounded-md bg-blue/10 px-2 py-0.5 text-xs font-medium text-blue">
                      {badge}
                    </span>
                  )}
                  {typeName && (
                    <span className="rounded-md bg-orange/10 px-2 py-0.5 text-xs font-medium text-orange">
                      {typeName}
                    </span>
                  )}
                  {mediaInfo?.genres && mediaInfo.genres.length > 0 && (
                    <span className="rounded-md bg-purple/10 px-2 py-0.5 text-xs font-medium text-purple">
                      {mediaInfo.genres.join(' / ')}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handlePlay}
                  className="gap-1.5 rounded-full bg-brand px-6 text-white hover:bg-brand/90"
                >
                  <Play className="h-4 w-4 fill-current" /> 播放
                </Button>
                <Button
                  variant="outline"
                  onClick={handleFavorite}
                  className={cn(
                    'gap-1.5 rounded-full border-border',
                    favorite && 'border-brand text-brand hover:bg-brand/10'
                  )}
                >
                  <Heart className={cn('h-4 w-4', favorite && 'fill-current')} /> 收藏
                </Button>
                <Button variant="outline" onClick={handleDownload} className="gap-1.5 rounded-full border-border">
                  <Download className="h-4 w-4" /> 下载
                </Button>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {typeName && (
                  <span>
                    分类：<span className="text-foreground">{typeName}</span>
                  </span>
                )}
                {year && (
                  <span>
                    年份：<span className="text-foreground">{year}</span>
                  </span>
                )}
                {region && (
                  <span>
                    地区：<span className="text-foreground">{region}</span>
                  </span>
                )}
                {language && (
                  <span>
                    语言：<span className="text-foreground">{language}</span>
                  </span>
                )}
                {mediaInfo?.duration && (
                  <span>
                    时长：<span className="text-foreground">{mediaInfo.duration}</span>
                  </span>
                )}
                {mediaInfo?.status && (
                  <span>
                    状态：<span className="text-foreground">{mediaInfo.status}</span>
                  </span>
                )}
              </div>

              {description && (
                <div className="max-w-3xl">
                  <p
                    ref={descriptionRef}
                    className={cn(
                      'text-sm leading-relaxed text-muted-foreground transition-all',
                      expanded ? '' : 'line-clamp-3'
                    )}
                  >
                    {description}
                  </p>
                  {(descriptionOverflows || expanded) && (
                    <button
                      onClick={() => setExpanded((v) => !v)}
                      className="mt-1 flex items-center gap-0.5 text-sm font-medium text-brand hover:underline"
                    >
                      {expanded ? '收起' : '展开'}
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 剧集列表 */}
      {showEpisodesSection && (
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-4 flex items-center gap-4">
            <h2 className="text-lg font-bold text-foreground">剧集列表</h2>
            {availableSourceTypes.length > 1 && (
              <div className="flex gap-2">
                {availableSourceTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setActiveSourceType(type)}
                    className={cn(
                      'relative px-3 py-1.5 text-sm font-medium transition-colors',
                      activeSourceType === type
                        ? 'text-brand'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {SOURCE_TYPE_NAMES[type]}
                    {activeSourceType === type && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-brand" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <div
              ref={episodesContainerRef}
              className={cn(
                'flex flex-wrap gap-3 transition-all duration-300',
                expandedEpisodes ? '' : 'max-h-[200px] overflow-hidden'
              )}
            >
              {currentEpisodes.map((ep, idx) => (
                <button
                  key={idx}
                  onClick={() => handleEpisodeClick(idx)}
                  className={cn(
                    'min-w-[4.5rem] rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                    selectedEpisode === idx
                      ? 'border-brand bg-brand text-white'
                      : 'border-border bg-card text-foreground hover:border-brand/50 hover:shadow-card'
                  )}
                >
                  {ep.title}
                </button>
              ))}
            </div>

            {!expandedEpisodes && showEpisodesExpandBtn && (
              <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none bg-gradient-to-t from-background via-background/90 to-transparent" />
            )}
          </div>

          {showEpisodesExpandBtn && (
            <button
              onClick={() => setExpandedEpisodes((v) => !v)}
              className="mt-2 flex items-center gap-0.5 text-sm font-medium text-brand hover:underline mx-auto"
            >
              {expandedEpisodes ? '收起' : '展开全部'}
              {expandedEpisodes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      )}

      {/* 演员阵容 */}
      {actorList.length > 0 && (
        <div className="mx-auto max-w-7xl px-6 py-8">
          <h2 className="mb-4 text-lg font-bold text-foreground">演员阵容</h2>
          <div className="flex flex-wrap gap-6">
            {actorList.map((actor, idx) => {
              const avatar = actorDetails[idx]?.avatar;
              return (
                <div key={idx} className="flex flex-col items-center gap-2">
                  <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted shadow-card md:h-20 md:w-20">
                    {avatar ? (
                      <LazyImage
                        src={avatar}
                        alt={actor.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="h-8 w-8 text-muted-foreground/50" />
                    )}
                  </div>
                  <span className="text-xs text-foreground">{actor.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 猜你喜欢：源不支持搜索或无结果时隐藏模块 */}
      {sourceCanSearch && recommendVideos.length > 0 && (
        <div className="mx-auto max-w-7xl px-6 py-8">
          <h2 className="mb-4 text-lg font-bold text-foreground">猜你喜欢</h2>
          <RecommendRow videos={recommendVideos} onCardClick={handleRecommendClick} />
        </div>
      )}

      {/* 更多信息 */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h2 className="mb-4 text-lg font-bold text-foreground">更多信息</h2>
        <div className="rounded-xl bg-card shadow-card p-5">
          <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
            {director && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">导演</dt>
                <dd className="text-foreground font-medium truncate">{director}</dd>
              </div>
            )}
            {typeName && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">类型</dt>
                <dd className="text-foreground font-medium truncate">{typeName}</dd>
              </div>
            )}
            {region && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">地区</dt>
                <dd className="text-foreground font-medium truncate">{region}</dd>
              </div>
            )}
            {language && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">语言</dt>
                <dd className="text-foreground font-medium truncate">{language}</dd>
              </div>
            )}
            {year && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">年份</dt>
                <dd className="text-foreground font-medium">{year}</dd>
              </div>
            )}
            {updateTime && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">更新时间</dt>
                <dd className="text-foreground font-medium truncate">{updateTime}</dd>
              </div>
            )}
            {detail?.vod_writer && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">编剧</dt>
                <dd className="text-foreground font-medium truncate">{detail.vod_writer}</dd>
              </div>
            )}
            {detail?.vod_duration && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">时长</dt>
                <dd className="text-foreground font-medium">{detail.vod_duration}</dd>
              </div>
            )}
            {detail?.vod_total && detail.vod_total > 1 && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">总集数</dt>
                <dd className="text-foreground font-medium">{detail.vod_total}</dd>
              </div>
            )}
            {detail?.vod_score_num && detail.vod_score_num > 0 && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">评分人数</dt>
                <dd className="text-foreground font-medium">{detail.vod_score_num}</dd>
              </div>
            )}
            {detail?.vod_hits && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">播放次数</dt>
                <dd className="text-foreground font-medium">{detail.vod_hits}</dd>
              </div>
            )}
            {detail?.vod_douban_id && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">豆瓣ID</dt>
                <dd className="text-foreground font-medium">{detail.vod_douban_id}</dd>
              </div>
            )}
            {detail?.vod_douban_score && detail.vod_douban_score !== '0.0' && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">豆瓣评分</dt>
                <dd className="text-foreground font-medium">{detail.vod_douban_score}</dd>
              </div>
            )}
            {detail?.vod_state && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">状态</dt>
                <dd className="text-foreground font-medium truncate">{detail.vod_state}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <DownloadDialog item={downloadItem} open={downloadOpen} onOpenChange={setDownloadOpen} />
    </div>
  );
};

export default Detail;
