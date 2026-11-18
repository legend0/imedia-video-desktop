/** Electron preload API 类型声明，对应 e/main/preload.js 和 API.md 文档 */

/** 统一包装格式（download、shell、user.getFavorites 使用） */
interface ApiResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 视频源测试结果 */
interface TestResult {
  success: boolean;
  responseTime: number;
  status: number;
  timestamp: number;
  error?: string;
  search?: boolean;
}

interface ElectronWindowAPI {
  minimize: () => Promise<{ success: boolean; error?: string }>;
  maximize: () => Promise<{ isMaximized: boolean }>;
  restore: () => Promise<{ success: boolean; error?: string }>;
  close: () => Promise<{ success: boolean; error?: string }>;
  hide: () => Promise<{ success: boolean; error?: string }>;
  show: () => Promise<{ success: boolean; error?: string }>;
  isMaximized: () => Promise<boolean>;
}

interface ElectronAppAPI {
  version: () => Promise<string>;
  quit: () => Promise<void>;
  restart: () => Promise<void>;
}

interface ElectronDialogAPI {
  openFile: (options?: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
  saveFile: (options?: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
  showMessageBox: (options?: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;
}

/** 后端源对象结构（对象形式存储，key 为源标识） */
interface BackendSource {
  key: string;
  name: string;
  url: string;
  path: string;
  type: 'json' | 'xml';
  enable: boolean;
  isActive: boolean;
  search: boolean;
  isAdult?: boolean;
  test?: TestResult;
  description?: string;
}

interface ElectronSourceAPI {
  /** 获取所有视频源（返回对象形式 {key: BackendSource, ...}） */
  getSourceList: () => Promise<Record<string, BackendSource>>;
  /** 添加视频源，返回是否成功 */
  addSource: (key: string, source: Partial<BackendSource>) => Promise<boolean>;
  /** 更新视频源，返回是否成功 */
  updateSource: (sourceKey: string, source: Partial<BackendSource>) => Promise<boolean>;
  /** 删除视频源，返回是否成功 */
  removeSource: (sourceKey: string) => Promise<boolean>;
  /** 获取当前激活源（含 key 字段），无源时返回 null */
  getCurrentSource: () => Promise<BackendSource | null>;
  /** 切换当前激活源，返回是否成功 */
  setCurrentSource: (sourceKey: string) => Promise<boolean>;
  /** 测试源连通性，返回测试结果 */
  testSource: (sourceKey: string) => Promise<TestResult>;
  /** 订阅源地址，返回 {success, data: {added, skipped, failed}} */
  subscribe: (url: string) => Promise<ApiResult<{ added: number; skipped: number; failed: number }>>;
}

interface ElectronVideoAPI {
  getCategories: (options?: unknown) => Promise<unknown>;
  getVideos: (categoryId: string, options?: unknown) => Promise<unknown>;
  search: (keyword: string, options?: unknown) => Promise<unknown>;
  getVideoDetail: (videoId: string) => Promise<unknown>;
  mediainfo: (movieName: string, options?: unknown) => Promise<unknown>;
  clearCache: () => Promise<unknown>;
  hotSearch: () => Promise<unknown>;
}

interface ElectronSettingsAPI {
  /** 获取设置项（直接返回值，不包装） */
  get: (key: string) => Promise<unknown>;
  /** 设置设置项（直接返回结果） */
  set: (key: string, value: unknown) => Promise<unknown>;
  /** 获取所有设置（直接返回对象） */
  getAll: () => Promise<Record<string, unknown>>;
  /** 批量设置（直接返回结果） */
  setAll: (settings: Record<string, unknown>) => Promise<unknown>;
  /** 重置所有设置 */
  reset: () => Promise<unknown>;
}

interface ElectronUserAPI {
  /** 获取收藏列表（返回 {success, data?, error?} 包装格式） */
  getFavorites: () => Promise<ApiResult<unknown[]>>;
  /** 添加收藏（返回是否成功） */
  addToFavorites: (video: unknown) => Promise<boolean>;
  /** 移除收藏（返回是否成功，可选按 sourceKey 过滤） */
  removeFromFavorites: (videoId: string, sourceKey?: string) => Promise<boolean>;
  /** 检查是否已收藏（返回布尔值） */
  isFavorite: (videoId: string, sourceKey?: string) => Promise<boolean>;
  /** 获取播放历史（直接返回数组，不包装） */
  getHistory: (options?: { limit?: number; sourceKey?: boolean }) => Promise<unknown[]>;
  /** 添加播放历史（返回是否成功） */
  addToHistory: (video: unknown) => Promise<boolean>;
  /** 移除单条播放记录（返回是否成功） */
  removeHistory: (videoId: string, sourceKey?: string) => Promise<boolean>;
  /** 清空播放历史（返回是否成功） */
  clearHistory: () => Promise<boolean>;
}

interface ElectronPlayerAPI {
  open: (videoData: unknown) => Promise<unknown>;
  close: () => Promise<unknown>;
  hide: () => Promise<unknown>;
  show: () => Promise<unknown>;
  isPlaying: () => Promise<boolean>;
  minimize: () => Promise<unknown>;
  toggleMaximize: () => Promise<unknown>;
  isMaximized: () => Promise<boolean>;
  toggleFullscreen: () => Promise<unknown>;
  isFullscreen: () => Promise<boolean>;
  togglePictureInPicture: () => Promise<unknown>;
  isPictureInPicture: () => Promise<boolean>;
  setImmersiveMode: (enabled: boolean) => Promise<unknown>;
}

interface ElectronShellAPI {
  openPath: (path: string) => Promise<{ success: boolean; error?: string }>;
  showItemInFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
}

/** 下载任务（后端返回的完整结构） */
interface BackendDownloadTask {
  id: string;
  url: string;
  type: string;
  savePath: string;
  fileName: string;
  thumbnail: string;
  videoId: string;
  keyInfo: unknown;
  sourceKey: string;
  description: string;
  quality: string;
  videoData: unknown;
  status: 'waiting' | 'downloading' | 'paused' | 'transcoding' | 'completed' | 'failed';
  totalSegments: number;
  downloadedSegments: number;
  progress: number;
  speed: number;
  remainingTime: number;
  segments: unknown[];
  tempDir: string;
  error: string;
  outputPath: string;
  finalSize: number;
  downloadStats: {
    segmentTimes: number[];
    segmentSizes: number[];
    windowSize: number;
    startTime: number | null;
    totalDownloadedSize: number;
  };
  transcodingProgress?: number;
}

interface ElectronDownloadAPI {
  addTask: (task: unknown) => Promise<ApiResult<{ taskId: string }>>;
  addBatchTasks: (taskList: unknown[]) => Promise<ApiResult<{ taskIds: string[] }>>;
  pauseTask: (taskId: string) => Promise<ApiResult<boolean>>;
  resumeTask: (taskId: string) => Promise<ApiResult<boolean>>;
  cancelTask: (taskId: string, deleteFiles?: boolean) => Promise<ApiResult<boolean>>;
  retryTask: (taskId: string) => Promise<ApiResult<boolean>>;
  getTaskList: () => Promise<ApiResult<BackendDownloadTask[]>>;
  getTaskInfo: (taskId: string) => Promise<ApiResult<BackendDownloadTask>>;
  selectDownloadDir: () => Promise<ApiResult<string | null>>;
  checkFfmpeg: () => Promise<ApiResult<{ available: boolean; path: string }>>;
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
}

/** 本地备份记录 */
interface BackupRecord {
  id: string;
  fileName: string;
  dataTypes: string[];
  createdAt: string;
  size: number;
  source: string;
}

/** WebDAV 配置 */
interface WebDAVConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  basePath: string;
}

/** WebDAV 备份记录 */
interface WebDAVBackupRecord {
  id: string;
  fileName: string;
  size: number;
  lastModified: string;
  source: string;
}

interface ElectronBackupAPI {
  /** 导出所选数据到文件（弹出保存对话框） */
  exportToFile: (dataTypes: string[]) => Promise<ApiResult<{ filePath: string }>>;
  /** 从文件导入并恢复数据（弹出打开对话框） */
  importFromFile: (dataTypes: string[]) => Promise<ApiResult<{ restored: string[] }>>;
  /** 创建本地备份记录 */
  createLocal: (dataTypes: string[]) => Promise<ApiResult<{ id: string; fileName: string }>>;
  /** 获取本地备份记录列表 */
  getLocalList: () => Promise<ApiResult<BackupRecord[]>>;
  /** 删除本地备份记录 */
  deleteLocal: (id: string) => Promise<ApiResult<null>>;
  /** 另存本地备份到用户选择的位置 */
  downloadLocal: (id: string) => Promise<ApiResult<{ filePath: string }>>;
  /** 获取 WebDAV 配置 */
  getWebDAVConfig: () => Promise<ApiResult<WebDAVConfig>>;
  /** 保存 WebDAV 配置 */
  setWebDAVConfig: (config: WebDAVConfig) => Promise<{ success: boolean }>;
  /** 测试 WebDAV 连接 */
  testWebDAV: (config: WebDAVConfig) => Promise<ApiResult<null>>;
  /** 上传备份到 WebDAV */
  uploadToWebDAV: (dataTypes: string[]) => Promise<ApiResult<{ fileName: string }>>;
  /** 列出 WebDAV 上的备份 */
  listWebDAV: () => Promise<ApiResult<WebDAVBackupRecord[]>>;
  /** 从 WebDAV 下载并恢复 */
  downloadFromWebDAV: (fileName: string, dataTypes: string[]) => Promise<ApiResult<{ restored: string[] }>>;
  /** 删除 WebDAV 上的备份 */
  deleteFromWebDAV: (fileName: string) => Promise<ApiResult<null>>;
}

interface ElectronEventAPI {
  on: (eventName: string, callback: (...args: unknown[]) => void) => void;
  off: (eventName: string, callback: (...args: unknown[]) => void) => void;
  once: (eventName: string, callback: (...args: unknown[]) => void) => void;
  emit: (eventName: string, ...args: unknown[]) => void;
}

/** 加速会话元信息 */
interface ProxySessionMeta {
  type: 'live' | 'vod';
  duration: number;
  bitrates: number[];
  ready: boolean;
  state: 'preparing' | 'ready' | 'expired';
}

/** boost 调用返回结果 */
interface ProxyBoostResult {
  ok: boolean;
  sessionId?: string;
  playUrl?: string;
  baseUrl?: string;
  meta?: ProxySessionMeta;
  error?: string;
}

/** 会话实时状态（含统计信息） */
interface ProxySessionInfo {
  ok: boolean;
  session?: {
    sessionId: string;
    sourceUrl: string;
    state: 'preparing' | 'ready' | 'expired';
    isLive: boolean;
    type: 'live' | 'vod';
    createdAt: string;
    lastAccessAt: string;
    activeUsers: number;
    prefetchProgress: { loaded: number; total: number; label?: string };
    variants: Array<{ label: string; bandwidth: number; resolution?: string }>;
    duration: number;
    stats: {
      segDownloadMs: number[];
      segOk: number;
      segFail: number;
      bytesServed: number;
      bytesFromCache: number;
      bytesFromOrigin: number;
      requests: number;
      avgDownloadMs: number;
    };
  };
  error?: string;
}

/** 全局统计 */
interface ProxyStatsResult {
  ok: boolean;
  stats?: {
    sessions: number;
    memory: unknown;
    disk: unknown;
    counters: { m3u8: { hit: number; miss: number }; ts: { hit: number; miss: number } };
    bytesServed: number;
    bytesFromCache: number;
    bytesFromOrigin: number;
    requests: number;
    cacheHitRate: string;
  };
  error?: string;
}

interface ElectronProxyAPI {
  /** 创建加速会话，返回本地加速播放 URL */
  boost: (url: string, opts?: { mode?: 'auto' | 'live' | 'vod'; cacheTtl?: number }) => Promise<ProxyBoostResult>;
  /** 销毁会话（可选，TTL 自动销毁已启用） */
  expire: (sessionId: string) => Promise<{ ok: boolean; expired?: boolean; error?: string }>;
  /** 获取会话实时状态（含统计信息） */
  sessionInfo: (sessionId: string) => Promise<ProxySessionInfo>;
  /** 列出所有活跃会话 */
  sessions: () => Promise<{ ok: boolean; sessions: unknown[]; error?: string }>;
  /** 全局统计 */
  stats: () => Promise<ProxyStatsResult>;
}

/** 电视直播频道（解析自 M3U 订阅源） */
interface IptvChannel {
  /** 频道名称 */
  name: string;
  /** 播放地址 */
  url: string;
  /** 分组名称（如"央视"、"卫视"） */
  group: string;
  /** 频道台标 URL */
  logo: string;
  /** tvg-id */
  tvgId: string;
  /** tvg-name */
  tvgName: string;
}

/** 订阅更新结果 */
interface IptvSubscriptionResult {
  success: boolean;
  data?: { count: number; groups: number };
  error?: string;
}

/** 订阅缓存元信息 */
interface IptvCacheInfo {
  success: boolean;
  data: { updatedAt: number; url: string; count: number; groups: number } | null;
}

interface ElectronIptvAPI {
  /** 触发订阅更新（Base64 解码 → 拉取 → 解析 → 永久缓存） */
  updateSubscription: (url: string) => Promise<IptvSubscriptionResult>;
  /** 获取缓存的频道列表（永久缓存，直至手动更新） */
  getChannels: () => Promise<IptvChannel[]>;
  /** 获取缓存的分组列表 */
  getGroups: () => Promise<string[]>;
  /** 获取当前订阅地址（未设置时返回默认地址） */
  getSubscriptionUrl: () => Promise<string>;
  /** 获取缓存元信息（更新时间、频道数、分组数） */
  getCacheInfo: () => Promise<IptvCacheInfo>;
}

interface ElectronAPI {
  window: ElectronWindowAPI;
  app: ElectronAppAPI;
  dialog: ElectronDialogAPI;
  source: ElectronSourceAPI;
  video: ElectronVideoAPI;
  settings: ElectronSettingsAPI;
  user: ElectronUserAPI;
  player: ElectronPlayerAPI;
  shell: ElectronShellAPI;
  download: ElectronDownloadAPI;
  backup: ElectronBackupAPI;
  proxy: ElectronProxyAPI;
  iptv: ElectronIptvAPI;
  on: ElectronEventAPI['on'];
  off: ElectronEventAPI['off'];
  once: ElectronEventAPI['once'];
  emit: ElectronEventAPI['emit'];
}

interface ElectronPlayerGlobal {
  on: (eventName: string, callback: (event: unknown, ...args: unknown[]) => void) => void;
  send: (eventName: string, ...args: unknown[]) => void;
  invoke: (eventName: string, ...args: unknown[]) => Promise<unknown>;
}

interface ElectronUtilsGlobal {
  platform: string;
  isDev: boolean;
  versions: NodeJS.ProcessVersions;
}

interface Window {
  API?: ElectronAPI;
  PLAYER?: ElectronPlayerGlobal;
  Utils?: ElectronUtilsGlobal;
  currentVideoPlayer?: unknown;
  Hls?: unknown;
  kampos?: unknown;
}
