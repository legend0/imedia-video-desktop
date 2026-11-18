import type { MediaItem } from '@/types';

/**
 * 后端视频原始数据结构（vod_ 前缀字段，CMS 标准）
 */
export interface BackendVideo {
  vod_id?: string | number;
  id?: string | number;
  vod_name?: string;
  title?: string;
  vod_remarks?: string;
  remarks?: string;
  type_name?: string;
  type?: string;
  vod_year?: string;
  year?: string;
  vod_area?: string;
  area?: string;
  vod_time?: string;
  updateTime?: string;
  vod_pic?: string;
  pic?: string;
  vod_content?: string;
  vod_play_url?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_lang?: string;
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
  /** 用户媒体模块写入的字段 */
  videoId?: string;
  sourceKey?: string;
  addedAt?: number;
  favorite?: boolean;
  tags?: string[];
  /** 剧集列表（播放历史/收藏保留的全量数据，切换源后仍可播放） */
  episodes?: { title?: string; url?: string }[];
  /** 视频描述 */
  description?: string;
}

/**
 * 后端历史记录数据结构
 */
export interface BackendHistoryItem {
  id?: string | number;
  video?: BackendVideo;
  title?: string;
  pic?: string;
  episodeIndex?: number;
  episode?: string;
  progress?: number;
  duration?: number;
  sourceKey?: string;
  updatedAt?: number;
}

/**
 * 将后端视频数据（vod_ 前缀字段）转换为前端 MediaItem 格式
 * @param video - 后端视频对象
 * @returns 前端 MediaItem 对象
 */
export function convertVideoToMediaItem(video: Record<string, unknown>): MediaItem {
  const v = video as BackendVideo;
  // 评分优先取豆瓣评分，其次站点评分；值为 '0.0' 时视为无评分
  const rating =
    (v.vod_douban_score && v.vod_douban_score !== '0.0')
      ? v.vod_douban_score
      : (v.vod_score && v.vod_score !== '0.0')
        ? v.vod_score
        : '';
  // 还原剧集列表（收藏/历史保留的全量数据），后端存储格式为 {title, url}
  const episodes = Array.isArray(v.episodes)
    ? v.episodes
        .filter((ep) => ep && ep.url)
        .map((ep) => ({ label: ep.title || '', url: ep.url as string }))
    : undefined;
  return {
    id: String(v.vod_id ?? v.id ?? v.videoId ?? ''),
    title: v.vod_name || v.title || '',
    badge: v.vod_remarks || v.remarks || '',
    type: v.type_name || v.type || '',
    year: v.vod_year || v.year || '',
    region: v.vod_area || v.area || '',
    updateTime: v.vod_time || v.updateTime || '',
    category: 'other',
    cover: v.vod_pic || v.pic,
    rating,
    vod_play_url: v.vod_play_url,
    description: v.description,
    director: v.vod_director,
    episodes,
    sourceKey: v.sourceKey,
  };
}

/**
 * 将后端历史记录转换为前端 MediaItem 格式
 * 保留全量播放数据（episodes/vod_play_url），以便切换源后仍可播放
 * @param item - 后端历史记录对象
 * @returns 前端 MediaItem 对象
 */
export function convertHistoryToMediaItem(item: Record<string, unknown>): MediaItem {
  const historyItem = item as BackendHistoryItem & {
    episodes?: { title?: string; url?: string }[];
    vod_play_url?: string;
    vod_name?: string;
    vod_pic?: string;
    // 后端 HistoryManager.add 会将 videoId 写入顶层（userMedia.js），需显式识别
    videoId?: string | number;
    // 直播记录标识（saveHistoryRecord 写入）
    format?: string;
    type?: string;
  };
  const video = (historyItem.video as BackendVideo) || {};
  // 还原剧集列表：历史记录顶层可能直接存储 episodes，也可能在 video 子对象中
  const rawEpisodes = historyItem.episodes || video.episodes;
  const episodes = Array.isArray(rawEpisodes)
    ? rawEpisodes
        .filter((ep) => ep && ep.url)
        .map((ep) => ({ label: ep.title || '', url: ep.url as string }))
    : undefined;
  return {
    // id 提取顺序：顶层 videoId（HistoryManager 实际写入字段） > 顶层 id > video.vod_id
    // 与 HistoryCard.convertHistoryToCardData 保持一致，避免历史记录因 id 为空被过滤
    id: String(historyItem.videoId ?? historyItem.id ?? video.vod_id ?? ''),
    // 直播记录：format 或 type 为 'live' 时，标题用频道名（title），badge 显示"电视直播"
    title: (historyItem.format === 'live' || historyItem.type === 'live')
      ? (historyItem.title || historyItem.vod_name || video.vod_name || '')
      : (historyItem.vod_name || video.vod_name || historyItem.title || ''),
    badge: (historyItem.format === 'live' || historyItem.type === 'live')
      ? '电视直播'
      : (historyItem.episodeIndex !== undefined ? `第${historyItem.episodeIndex + 1}集` : ''),
    type: video.type_name || '',
    year: video.vod_year || '',
    region: video.vod_area || '',
    updateTime: '',
    category: 'other',
    // cover 回退：顶层 pic > 顶层 vod_pic > video.vod_pic
    cover: historyItem.pic || historyItem.vod_pic || video.vod_pic,
    vod_play_url: historyItem.vod_play_url || video.vod_play_url,
    description: video.description,
    director: video.vod_director,
    episodes,
    sourceKey: historyItem.sourceKey || video.sourceKey,
  };
}

/**
 * 将前端 MediaItem 转换为后端 Video 数据结构（用于收藏/历史写入）
 * 注意：后端 userMedia.add 会优先取 rawData.vod_id || rawData.videoId 作为唯一标识
 * 因此必须显式设置 videoId 字段，避免后端识别失败
 * 保留 vod_play_url/episodes 等全量播放数据，以便切换源后仍可播放
 * @param item - 前端 MediaItem 对象
 * @param sourceKey - 可选的源键名，未提供时后端会使用当前激活源
 * @returns 后端 Video 数据对象
 */
export function convertMediaItemToBackendVideo(
  item: MediaItem,
  sourceKey?: string
): BackendVideo {
  const video: BackendVideo = {
    videoId: item.id,
    vod_id: item.id,
    vod_name: item.title,
    vod_pic: item.cover,
    vod_remarks: item.badge,
    type_name: item.type,
    vod_year: item.year,
    vod_area: item.region,
    vod_time: item.updateTime,
    tags: item.tags,
    // 保留全量播放数据，以便切换源后仍可播放
    vod_play_url: item.vod_play_url,
    vod_director: item.director,
    description: item.description,
  };
  // 剧集列表：MediaItem.Episode 为 {label, url}，后端存储为 {title, url}
  if (item.episodes && item.episodes.length > 0) {
    video.episodes = item.episodes
      .filter((ep) => ep.url)
      .map((ep) => ({ title: ep.label, url: ep.url }));
  }
  // 保留源键名：显式传入优先，否则回退到 item 自带的 sourceKey（切换源后仍可标识来源）
  const finalSourceKey = sourceKey || item.sourceKey;
  if (finalSourceKey) {
    video.sourceKey = finalSourceKey;
  }
  return video;
}
