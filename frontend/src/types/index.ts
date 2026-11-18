export interface Option {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  withCount?: boolean;
}

export type Category = 'anime' | 'movie' | 'tv' | 'show' | 'other' | 'adult';

export interface Actor {
  name: string;
  role?: string;
}

export interface Episode {
  label: string;
  url?: string;
}

export interface MediaItem {
  id: string;
  title: string;
  badge: string;
  type: string;
  year: string;
  region: string;
  updateTime: string;
  category: Category;
  cover?: string;
  placeholder?: boolean;
  rating?: string;
  originalName?: string;
  language?: string;
  description?: string;
  director?: string;
  actors?: Actor[];
  episodes?: Episode[];
  tags?: string[];
  /** 后端原始播放地址字符串（vod_play_url），用于下载时解析剧集 */
  vod_play_url?: string;
  /** 数据所属源键名，用于标识收藏/历史记录来源于哪个源 */
  sourceKey?: string;
}

export interface SourceItemData {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  adult: boolean;
  format: string;
  searchable: boolean | null;
  responseTime?: number;
  failed?: boolean;
  description?: string;
  /** 是否为当前激活源 */
  isActive?: boolean;
  /** 是否为默认源（不可删除） */
  isDefault?: boolean;
}
