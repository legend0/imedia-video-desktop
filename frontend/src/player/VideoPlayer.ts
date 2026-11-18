import { parsePlayUrl, captureVideoFrame, Modal } from './utils/helper';
import { adaptiveDeblock } from './DeblockFilterType';

/** 单集信息 */
export interface VideoEpisode {
  title: string;
  url: string;
  number?: number;
  duration?: number;
}

/** 传入播放器的视频数据 */
export interface VideoData {
  video?: {
    vod_name: string;
    vod_pic?: string;
    vod_play_url?: string;
    vod_id?: string;
  };
  title?: string;
  vod_name?: string;
  vod_pic?: string;
  pic?: string;
  vod_play_url?: string;
  episodes?: VideoEpisode[];
  vod_id?: string;
  id?: string;
  videoId?: string;
  type?: string;
  url?: string;
  episodeIndex?: number;
  currentEpisode?: number;
  sourceKey?: string;
  description?: string;
}

/** 历史记录条目 */
export interface HistoryRecord {
  videoId: string;
  title: string;
  pic?: string;
  progress: number;
  duration: number;
  episodeIndex: number;
  format: string;
  sourceKey: string;
}

/** 播放源类型 */
type SourceType = 'm3u8' | 'mp4' | 'iframe' | 'live';

/** 解析后的剧集项 */
interface EpisodeItem {
  title: string;
  url: string;
  type: SourceType;
}

/** Kampos 画质增强参数 */
interface KamposParams {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  deblock: number;
}

/** HLS 生产环境配置 */
const PRODUCTION_HLS_CONFIG = {
  enableWorker: true,
  workerPath: './player/hls.worker.js',
  enableSoftwareAES: true,
  maxBufferSize: 100 * 1000 * 1000,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 5,
  manifestLoadingTimeOut: 10000,
  manifestLoadingMaxRetry: 4,
  manifestLoadingRetryDelay: 1000,
  manifestLoadingMaxRetryTimeout: 64000,
  levelLoadingTimeOut: 10000,
  levelLoadingMaxRetry: 4,
  levelLoadingRetryDelay: 1000,
  levelLoadingMaxRetryTimeout: 64000,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 1000,
  fragLoadingMaxRetryTimeout: 64000,
  startLevel: -1,
  abrEwmaFastLive: 3,
  abrEwmaSlowLive: 9,
  abrEwmaFastVoD: 3,
  abrEwmaSlowVoD: 9,
  abrEwmaDefaultEstimate: 1000000,
  fmp4: false,
  autoStartLoad: true,
  startPosition: -1,
  seekMode: 'range',
  debug: false,
  enableWebVTT: true,
  enableCEA708Captions: true,
  stretchShortVideoTrack: true,
  forceKeyFrameOnDiscontinuity: true,
};

/** HLS 开发环境配置 */
const DEVELOPMENT_HLS_CONFIG = {
  enableWorker: false,
};

/** 源类型显示名称 */
const SOURCE_TYPE_NAMES: Record<SourceType, string> = {
  m3u8: '在线播放',
  mp4: 'MP4下载',
  iframe: '网页播放',
  live: '直播',
};

/**
 * 视频播放器类
 * 负责视频播放、控制、剧集管理、画质增强等完整功能
 */
export class VideoPlayer {
  /** video 元素 */
  video: HTMLVideoElement | null = null;
  /** 当前剧集索引 */
  currentEpisode = 0;
  /** 当前播放源类型 */
  currentFormat: SourceType = 'm3u8';
  /** 当前源剧集列表 */
  episodes: EpisodeItem[] = [];
  /** 按格式分组的剧集 */
  episodesByFormat: Record<SourceType, EpisodeItem[]> = {
    m3u8: [],
    mp4: [],
    iframe: [],
    live: [],
  };
  /** HLS 实例 */
  hls: unknown = null;
  /** Kampos 实例 */
  kamposInstance: unknown = null;
  /** Kampos effects 引用 */
  kamposEffects: Record<string, unknown> | null = null;
  /** 是否开启画质增强 */
  kamposEnhanced = false;
  /** Kampos 参数 */
  kamposParams: KamposParams = {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpness: 0.0,
    deblock: 0.0,
  };
  /** 是否全屏 */
  isFullscreen = false;
  /** 是否正在播放 */
  isPlaying = false;
  /** 音量 0-1 */
  volume = 0.5;
  /** 播放速度 */
  playbackRate = 1;
  /** 是否静音 */
  isMuted = false;
  /** 是否正在拖拽进度 */
  isDraggingProgress = false;
  /** 视频数据 */
  videoData: VideoData;
  /** 容器元素 */
  container: HTMLElement | null = null;
  /** 历史记录 */
  historyRecord: HistoryRecord | null = null;
  /** 是否正在销毁 */
  isDestroying = false;

  // 设置项
  /** 自动播放 */
  autoplay = false;
  /** 跳转步长（秒） */
  skipStep = 10;
  /** 音量步长 */
  volumeStep = 0.1;
  /** 自动全屏 */
  autoFullscreen = true;
  /** 显示控制条 */
  showControlsEnabled = true;
  /** 控制条隐藏延迟 */
  controlsHideDelay = 3000;
  /** 跳过片头秒数 */
  skipIntroTime = 0;
  /** 跳过片尾秒数 */
  skipOutroTime = 0;
  /** 自动播放下一集 */
  autoNext = true;
  /** HLS 启用 Worker */
  hlsEnableWorker = true;
  /** HLS 软件 AES 解密 */
  hlsEnableSoftwareAES = true;
  /** HLS 最大缓冲区大小（字节） */
  hlsMaxBufferSize = 50 * 1000 * 1000;
  /** HLS 最大缓冲时长（秒） */
  hlsMaxBufferLength = 30;
  /** 当前旋转角度 */
  currentRotation = 0;
  /** 当前画面比例 */
  currentAspectRatio = 'auto';
  /** 沉浸模式 */
  isImmersiveMode = false;
  /** M3U8 加速代理开关（默认开启，失败自动降级为直连） */
  boostEnabled = true;
  /** 当前加速会话 ID（用于视频信息统计查询，无会话时为 null） */
  proxySessionId: string | null = null;

  // 定时器
  private controlsTimeout: ReturnType<typeof setTimeout> | null = null;
  private centerPlayBtnTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageTimeout: ReturnType<typeof setTimeout> | null = null;
  private mouseTimeout: ReturnType<typeof setTimeout> | null = null;
  private volumeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private historySaveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHistorySaveTime = 0;
  private readonly historySaveInterval = 5000;

  // 鼠标状态
  private isMouseVisible = true;
  private lastMouseMoveTime = 0;

  // 设置面板状态
  private isSettingsPanelVisible = false;
  /** 设置面板 mouseleave 延迟隐藏定时器，mouseenter 时清除避免堆积 */
  private settingsHideTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private _kamposPendingEnable = false;
  /** AbortController 统一管理 document 级事件监听，destroy() 时一次性移除 */
  private eventAbortController: AbortController | null = null;

  constructor(videoData: VideoData) {
    this.videoData = videoData;
    this._loadKamposSettings();
    this.renderHTML();
  }

  /** 初始化播放器 */
  async init(): Promise<void> {
    await this.loadPlayerSettings();
    this.bindEvents();
    this.bindIpcEvents();
    this.loadVideoData();
    this.updateUI();
    this.showControls();
    // 应用初始画面比例/旋转布局
    this.applyVideoLayout();
    // 窗口尺寸变化时重新计算画面比例矩形
    window.addEventListener('resize', this.handleResize);
  }

  /** 窗口尺寸变化时重新计算布局（防抖） */
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private handleResize = (): void => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.applyVideoLayout();
    }, 150);
  };

  /** 渲染播放器 HTML 结构 */
  renderHTML(): void {
    const container = document.getElementById('playerContainer');
    if (!container) return;

    this.container = container;
    container.innerHTML = `
      <div class="player-header" id="playerHeader">
        <div class="header-left">
          <h1 class="video-title" id="videoTitle">视频标题</h1>
          <p class="video-subtitle" id="videoSubtitle"></p>
        </div>
        <div class="header-right">
          <button class="window-control playlist-btn" id="playlistBtnTop" style="display: none;">
            <svg class="icon" viewBox="0 0 24 24" width="18" height="18"><line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"/><line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2"/><line x1="3" y1="6" x2="3.01" y2="6" stroke="currentColor" stroke-width="2"/><line x1="3" y1="12" x2="3.01" y2="12" stroke="currentColor" stroke-width="2"/><line x1="3" y1="18" x2="3.01" y2="18" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="window-control minimize" id="minimizeBtn">
            <svg class="icon" viewBox="0 0 24 24" width="18" height="18"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="window-control maximize" id="maximizeBtn">
            <svg class="icon" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/></svg>
          </button>
          <button class="window-control close" id="closeBtn">
            <svg class="icon" viewBox="0 0 24 24" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>
      </div>

      <div class="video-area" id="videoArea">
        <div class="center-play-btn" id="centerPlayBtn">
          <svg class="icon" viewBox="0 0 24 24" width="32" height="32"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
        </div>
        <video class="video-player" id="videoPlayer" playsinline webkit-playsinline></video>
        <canvas class="kampos-canvas" id="kamposCanvas" style="display: none;"></canvas>
        <div class="iframe-poster" id="iframePoster" style="display: none;">
          <img id="iframePosterImg" src="" alt="封面" />
        </div>
        <iframe class="iframe-player" id="iframePlayer" style="display: none;" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe>
        <div class="loading-overlay" id="loadingOverlay">
          <div class="loading-spinner"><span></span></div>
          <p class="loading-text">加载中...</p>
        </div>
        <div class="error-overlay" id="errorOverlay" style="display: none;">
          <div class="error-icon">
            <svg class="icon" viewBox="0 0 24 24" width="48" height="48"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2"/></svg>
          </div>
          <p class="error-text" id="errorText">视频加载失败</p>
          <button class="retry-btn" id="retryBtn">重试</button>
        </div>
        <div class="mini-progress-container" id="miniProgressContainer">
          <div class="mini-progress-loaded" id="miniProgressLoaded"></div>
          <div class="mini-progress-played" id="miniProgressPlayed"></div>
          <div class="mini-progress-hover" id="miniProgressHover"></div>
        </div>
      </div>

      <div class="player-controls" id="playerControls">
        <div class="progress-container" id="progressContainer">
          <div class="progress-bar" id="progressBar">
            <div class="progress-loaded" id="progressLoaded"></div>
            <div class="progress-played" id="progressPlayed"></div>
            <div class="progress-hover" id="progressHover"></div>
            <div class="progress-handle" id="progressHandle"></div>
            <div class="progress-time-tooltip" id="progressTimeTooltip">00:00</div>
          </div>
        </div>
        <div class="controls-container">
          <div class="message-container" id="messageContainer"></div>
          <div class="controls-left">
            <button class="control-btn prev-btn" id="prevBtn" title="上一集">
              <svg class="icon" viewBox="0 0 24 24" width="20" height="20"><polygon points="19 20 9 12 19 4 19 20" fill="currentColor"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"/></svg>
            </button>
            <button class="control-btn play-pause-btn" id="playPauseBtn" title="播放/暂停">
              <svg class="icon" viewBox="0 0 24 24" width="24" height="24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
            </button>
            <div class="live-indicator" id="liveIndicator" style="display: none;">
              <span class="live-dot"></span>
              <span class="live-text">直播</span>
            </div>
            <button class="control-btn next-btn" id="nextBtn" title="下一集">
              <svg class="icon" viewBox="0 0 24 24" width="20" height="20"><polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/></svg>
            </button>
            <div class="volume-container" id="volumeContainer">
              <button class="control-btn volume-btn" id="volumeBtn" title="音量">
                <svg class="icon" viewBox="0 0 24 24" width="20" height="20"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/></svg>
              </button>
              <div class="volume-slider" id="volumeSlider">
                <input type="range" class="volume-range" id="volumeRange" min="0" max="100" value="50">
              </div>
            </div>
            <div class="time-display" id="timeDisplay">
              <span id="currentTime">00:00</span> / <span id="duration">00:00</span>
            </div>
          </div>
          <div class="controls-right">
            <div class="settings-container" id="settingsContainer">
              <button class="control-btn settings-btn" id="settingsBtn" title="播放器设置">
                <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <div class="settings-panel" id="settingsPanel" style="visibility: hidden; opacity: 0;">
                <div class="settings-header">
                  <div class="settings-title">播放器设置</div>
                  <button class="settings-close-btn" id="settingsCloseBtn">
                    <svg class="icon" viewBox="0 0 24 24" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
                  </button>
                </div>
                <div class="settings-section">
                  <div class="settings-section-title">播放速度</div>
                  <div class="segment-pills" id="speedPills">
                    <button class="segment-pill" data-value="0.5">0.5x</button>
                    <button class="segment-pill" data-value="0.75">0.75x</button>
                    <button class="segment-pill active" data-value="1">1.0x</button>
                    <button class="segment-pill" data-value="1.25">1.25x</button>
                    <button class="segment-pill" data-value="1.5">1.5x</button>
                    <button class="segment-pill" data-value="2">2.0x</button>
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-title">视频旋转</div>
                  <div class="segment-pills" id="rotatePills">
                    <button class="segment-pill active" data-value="0">0°</button>
                    <button class="segment-pill" data-value="90">90°</button>
                    <button class="segment-pill" data-value="180">180°</button>
                    <button class="segment-pill" data-value="270">270°</button>
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-title">画面比例</div>
                  <div class="segment-pills" id="aspectRatioPills">
                    <button class="segment-pill active" data-value="auto">默认</button>
                    <button class="segment-pill" data-value="16:9">16:9</button>
                    <button class="segment-pill" data-value="4:3">4:3</button>
                    <button class="segment-pill" data-value="stretch">拉伸</button>
                    <button class="segment-pill" data-value="custom">自定义</button>
                  </div>
                  <div class="custom-ratio-group" id="customRatioGroup" style="display: none; margin-top: 8px;">
                    <input type="number" id="customRatioW" class="settings-input" min="1" max="32" step="1" value="21" style="width: 56px; text-align: center;">
                    <span style="color: hsl(var(--muted-foreground)); margin: 0 4px;">:</span>
                    <input type="number" id="customRatioH" class="settings-input" min="1" max="32" step="1" value="9" style="width: 56px; text-align: center;">
                    <button class="segment-pill" id="applyCustomRatio" style="margin-left: 6px; padding: 4px 10px;">应用</button>
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-title">跳过时间(秒)</div>
                  <div class="settings-input-group">
                    <label for="skipIntroInput">片头</label>
                    <input type="number" id="skipIntroInput" class="settings-input" min="0" max="600" value="0">
                  </div>
                  <div class="settings-input-group" style="margin-top: 8px;">
                    <label for="skipOutroInput">片尾</label>
                    <input type="number" id="skipOutroInput" class="settings-input" min="0" max="600" value="0">
                  </div>
                </div>

              </div>
            </div>
            <button class="control-btn quality-btn" id="qualityBtn" title="画质设置">
              <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 10.7l-5.8 1.9L12 18.4l-1.9-5.8L4 10.7l5.8-1.9L12 3z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>
            </button>
            <button class="control-btn playlist-btn" id="playlistBtn" title="剧集列表">
              <svg class="icon" viewBox="0 0 24 24" width="20" height="20"><line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"/><line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2"/><line x1="3" y1="6" x2="3.01" y2="6" stroke="currentColor" stroke-width="2"/><line x1="3" y1="12" x2="3.01" y2="12" stroke="currentColor" stroke-width="2"/><line x1="3" y1="18" x2="3.01" y2="18" stroke="currentColor" stroke-width="2"/></svg>
            </button>
            <button class="control-btn pip-btn" id="pipBtn" title="沉浸模式">
              <svg class="icon" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </button>
            <button class="control-btn fullscreen-btn" id="fullscreenBtn" title="全屏">
              <svg class="icon" viewBox="0 0 24 24" width="20" height="20"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="playlist-panel" id="playlistPanel">
        <div class="playlist-header">
          <div class="playlist-title">剧集列表</div>
          <button class="playlist-close-btn" id="closePlaylistBtn">
            <svg class="icon" viewBox="0 0 24 24" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>
        <div class="playlist-tabs" id="playlistTabs"></div>
        <div class="playlist-content" id="playlistContent"></div>
      </div>

      <div class="context-menu" id="contextMenu" style="display: none;"></div>

      <div class="playback-info-panel" id="playbackInfoPanel" style="display: none;">
        <div class="playback-info-header">
          <div class="playback-info-title">播放信息</div>
          <button class="playback-info-close-btn" id="closePlaybackInfo">
            <svg class="icon" viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>
        <div class="playback-info-body" id="playbackInfoBody"></div>
      </div>

      <div class="modal-overlay" id="enhanceModal" style="display: none;">
        <div class="modal-content enhance-modal-content">
          <div class="modal-header">
            <div class="modal-title">画质增强</div>
            <button class="modal-close-btn" id="closeEnhanceModal">
              <svg class="icon" viewBox="0 0 24 24" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
            </button>
          </div>
          <div class="modal-body enhance-modal-body">
            <div class="enhance-section">
              <div class="enhance-row">
                <div class="enhance-label"><span>亮度</span></div>
                <div class="enhance-slider-group">
                  <input type="range" class="enhance-slider" id="enhanceBrightness" min="0.5" max="2.0" step="0.05" value="1.0">
                  <span class="enhance-value" id="enhanceBrightnessValue">1.00</span>
                </div>
              </div>
              <div class="enhance-row">
                <div class="enhance-label"><span>对比度</span></div>
                <div class="enhance-slider-group">
                  <input type="range" class="enhance-slider" id="enhanceContrast" min="0.5" max="2.0" step="0.05" value="1.0">
                  <span class="enhance-value" id="enhanceContrastValue">1.00</span>
                </div>
              </div>
              <div class="enhance-row">
                <div class="enhance-label"><span>饱和度</span></div>
                <div class="enhance-slider-group">
                  <input type="range" class="enhance-slider" id="enhanceSaturation" min="0.0" max="3.0" step="0.05" value="1.0">
                  <span class="enhance-value" id="enhanceSaturationValue">1.00</span>
                </div>
              </div>
              <div class="enhance-row">
                <div class="enhance-label"><span>锐度</span></div>
                <div class="enhance-slider-group">
                  <input type="range" class="enhance-slider" id="enhanceSharpness" min="0.0" max="2.0" step="0.05" value="0.0">
                  <span class="enhance-value" id="enhanceSharpnessValue">0.00</span>
                </div>
              </div>
              <div class="enhance-row">
                <div class="enhance-label"><span>去块噪点</span></div>
                <div class="enhance-slider-group">
                  <input type="range" class="enhance-slider" id="enhanceDeblock" min="0.0" max="1.0" step="0.05" value="0.0">
                  <span class="enhance-value" id="enhanceDeblockValue">0.00</span>
                </div>
              </div>
            </div>
            <div class="enhance-actions">
              <button class="enhance-btn enhance-btn-reset" id="enhanceResetBtn">重置</button>
              <button class="enhance-btn enhance-btn-toggle" id="enhanceToggleBtn">开启增强</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /** 加载播放器设置 */
  private async loadPlayerSettings(): Promise<void> {
    if (!window.API?.settings) return;
    try {
      const allSettings = await window.API.settings.getAll();
      const settings = (allSettings.player || {}) as Record<string, unknown>;
      this.autoplay = (settings.autoplay as boolean) || false;
      this.playbackRate = (settings.speed as number) || 1.0;
      this.volume = ((settings.volume as number) || 50) / 100;
      this.skipStep = (settings.skipStep as number) || 10;
      this.volumeStep = ((settings.volumeStep as number) || 10) / 100;
      this.autoFullscreen = settings.autoFullscreen !== undefined ? (settings.autoFullscreen as boolean) : true;
      this.showControlsEnabled = settings.showControls !== undefined ? (settings.showControls as boolean) : true;
      this.controlsHideDelay = (settings.controlsHideDelay as number) || 3000;
      this.skipIntroTime = (settings.skipIntroTime as number) || 0;
      this.skipOutroTime = (settings.skipOutroTime as number) || 0;
      this.autoNext = settings.autoNext !== undefined ? (settings.autoNext as boolean) : true;
      this.hlsEnableWorker = settings.hlsEnableWorker !== undefined ? (settings.hlsEnableWorker as boolean) : true;
      this.hlsEnableSoftwareAES = settings.hlsEnableSoftwareAES !== undefined ? (settings.hlsEnableSoftwareAES as boolean) : true;
      // 缓冲区大小配置以 MB 为单位存储，转换为字节
      const hlsBufferSizeMB = (settings.hlsMaxBufferSize as number) || 50;
      this.hlsMaxBufferSize = hlsBufferSizeMB * 1000 * 1000;
      this.hlsMaxBufferLength = (settings.hlsMaxBufferLength as number) || 30;
      // 加速代理开关：从系统设置 player.boostEnabled 读取（默认开启）
      this.boostEnabled = settings.boostEnabled !== undefined ? (settings.boostEnabled as boolean) : true;
      // 初始化设置面板输入框的值
      const skipIntroInput = document.getElementById('skipIntroInput') as HTMLInputElement;
      if (skipIntroInput) skipIntroInput.value = String(this.skipIntroTime);
      const skipOutroInput = document.getElementById('skipOutroInput') as HTMLInputElement;
      if (skipOutroInput) skipOutroInput.value = String(this.skipOutroTime);
      // 同步播放速度分段按钮的选中状态
      const speedPills = document.getElementById('speedPills');
      if (speedPills) {
        const activePill = speedPills.querySelector(`[data-value="${this.playbackRate}"]`);
        if (activePill) this.updatePillActive('speedPills', activePill as HTMLElement);
      }
      // 恢复画面比例设置
      const savedRatio = (settings.aspectRatio as string) || 'auto';
      this.currentAspectRatio = savedRatio;
      const ratioPills = document.getElementById('aspectRatioPills');
      if (ratioPills) {
        // 自定义比例需要展开输入框并回填数值
        const isCustom = savedRatio.includes(':') && !['16:9', '4:3'].includes(savedRatio);
        const pillValue = isCustom ? 'custom' : savedRatio;
        const activePill = ratioPills.querySelector(`[data-value="${pillValue}"]`);
        if (activePill) this.updatePillActive('aspectRatioPills', activePill as HTMLElement);
        if (isCustom) {
          const customGroup = document.getElementById('customRatioGroup');
          if (customGroup) customGroup.style.display = 'flex';
          const [w, h] = savedRatio.split(':');
          const wInput = document.getElementById('customRatioW') as HTMLInputElement | null;
          const hInput = document.getElementById('customRatioH') as HTMLInputElement | null;
          if (wInput) wInput.value = w;
          if (hInput) hInput.value = h;
        }
      }
    } catch (error) {
      console.warn('[VideoPlayer] 加载设置失败:', error);
    }
  }

  /**
   * 更新分段按钮组的选中状态
   * @param containerId - 按钮组容器 ID
   * @param activeEl - 当前选中的按钮元素
   */
  private updatePillActive(containerId: string, activeEl: HTMLElement): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.segment-pill').forEach((pill) => {
      pill.classList.remove('active');
    });
    activeEl.classList.add('active');
  }

  /** 绑定事件 */
  bindEvents(): void {
    this.video = document.getElementById('videoPlayer') as HTMLVideoElement;
    if (!this.video) return;

    this.eventHandlers = {
      onMetadataLoaded: () => this.onMetadataLoaded(),
      onTimeUpdate: () => this.onTimeUpdate(),
      onProgress: () => this.onProgress(),
      onPlay: () => this.onPlay(),
      onPause: () => this.onPause(),
      onEnded: () => this.onEnded(),
      onWaiting: () => this.onWaiting(),
      onCanPlay: () => this.onCanPlay(),
      onError: () => this.onError(),
      togglePlay: () => this.togglePlay(),
      playPrevious: () => this.playPrevious(),
      playNext: () => this.playNext(),
      toggleMute: () => this.toggleMute(),
      toggleFullscreen: () => this.toggleFullscreen(),
      toggleSettings: () => this.toggleSettings(),
      hideSettings: () => this.hideSettings(),
      toggleEpisodeList: () => this.toggleEpisodeList(),
      toggleImmersiveMode: () => this.toggleImmersiveMode(),
      handleMouseMove: () => this.handleMouseMove(),
      handleKeyboard: (e: unknown) => this.handleKeyboard(e as KeyboardEvent),
    };

    this.video.addEventListener('loadedmetadata', this.eventHandlers.onMetadataLoaded as EventListener);
    this.video.addEventListener('timeupdate', this.eventHandlers.onTimeUpdate as EventListener);
    this.video.addEventListener('progress', this.eventHandlers.onProgress as EventListener);
    this.video.addEventListener('play', this.eventHandlers.onPlay as EventListener);
    this.video.addEventListener('pause', this.eventHandlers.onPause as EventListener);
    this.video.addEventListener('ended', this.eventHandlers.onEnded as EventListener);
    this.video.addEventListener('waiting', this.eventHandlers.onWaiting as EventListener);
    this.video.addEventListener('canplay', this.eventHandlers.onCanPlay as EventListener);
    this.video.addEventListener('error', this.eventHandlers.onError as EventListener);

    document.getElementById('playPauseBtn')?.addEventListener('click', this.eventHandlers.togglePlay);
    document.getElementById('prevBtn')?.addEventListener('click', this.eventHandlers.playPrevious);
    document.getElementById('nextBtn')?.addEventListener('click', this.eventHandlers.playNext);
    document.getElementById('volumeBtn')?.addEventListener('click', this.eventHandlers.toggleMute);
    document.getElementById('fullscreenBtn')?.addEventListener('click', this.eventHandlers.toggleFullscreen);
    document.getElementById('settingsBtn')?.addEventListener('click', this.eventHandlers.toggleSettings);
    document.getElementById('settingsCloseBtn')?.addEventListener('click', this.eventHandlers.hideSettings);
    document.getElementById('playlistBtn')?.addEventListener('click', this.eventHandlers.toggleEpisodeList);
    document.getElementById('playlistBtnTop')?.addEventListener('click', this.eventHandlers.toggleEpisodeList);
    document.getElementById('pipBtn')?.addEventListener('click', this.eventHandlers.toggleImmersiveMode);
    document.getElementById('closePlaylistBtn')?.addEventListener('click', this.eventHandlers.toggleEpisodeList);

    const volumeRange = document.getElementById('volumeRange') as HTMLInputElement;
    volumeRange?.addEventListener('input', () => {
      this.setVolume(parseInt(volumeRange.value, 10) / 100);
    });

    document.getElementById('progressBar')?.addEventListener('click', (e) => this.seekTo(e));
    document.getElementById('progressBar')?.addEventListener('mousemove', (e) => this.onProgressHover(e));
    document.getElementById('progressBar')?.addEventListener('mousedown', (e) => this.startProgressDrag(e));

    const miniProgress = document.getElementById('miniProgressContainer');
    miniProgress?.addEventListener('click', (e) => this.seekToMini(e));
    miniProgress?.addEventListener('mousemove', (e) => this.onMiniProgressHover(e));
    miniProgress?.addEventListener('mouseleave', () => this.onMiniProgressLeave());

    // 播放速度分段按钮
    document.getElementById('speedPills')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('segment-pill')) return;
      const speed = parseFloat(target.dataset.value || '1');
      this.setPlaybackRate(speed);
      this.updatePillActive('speedPills', target);
      this.showMessage(`播放速度：${speed}x`);
    });

    // 视频旋转分段按钮
    document.getElementById('rotatePills')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('segment-pill')) return;
      const rotation = parseInt(target.dataset.value || '0');
      this.setRotation(rotation);
      this.updatePillActive('rotatePills', target);
      this.showMessage(`视频旋转：${rotation}°`);
    });

    // 画面比例分段按钮
    document.getElementById('aspectRatioPills')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('segment-pill')) return;
      const ratio = target.dataset.value || 'auto';
      // 自定义比例：展开输入框，等待用户输入后再应用
      const customGroup = document.getElementById('customRatioGroup');
      if (ratio === 'custom') {
        if (customGroup) customGroup.style.display = 'flex';
        this.updatePillActive('aspectRatioPills', target);
        // 若已有保存的自定义比例，立即应用
        if (this.currentAspectRatio.includes(':')) {
          this.setAspectRatio(this.currentAspectRatio);
          this.showMessage(`画面比例：${this.currentAspectRatio}`);
        } else {
          this.showMessage('请输入自定义宽高比');
        }
        return;
      }
      if (customGroup) customGroup.style.display = 'none';
      this.setAspectRatio(ratio);
      this.updatePillActive('aspectRatioPills', target);
      const ratioLabel = ratio === 'auto' ? '默认' : ratio === 'stretch' ? '拉伸' : ratio;
      this.showMessage(`画面比例：${ratioLabel}`);
    });

    // 自定义比例应用按钮
    document.getElementById('applyCustomRatio')?.addEventListener('click', () => {
      const wInput = document.getElementById('customRatioW') as HTMLInputElement | null;
      const hInput = document.getElementById('customRatioH') as HTMLInputElement | null;
      if (!wInput || !hInput) return;
      const w = parseInt(wInput.value) || 0;
      const h = parseInt(hInput.value) || 0;
      if (w <= 0 || h <= 0) {
        this.showMessage('请输入有效的宽高比');
        return;
      }
      if (w > 32 || h > 32) {
        this.showMessage('宽高比数值过大，请输入 1-32 之间的数字');
        return;
      }
      const customRatio = `${w}:${h}`;
      this.setAspectRatio(customRatio);
      this.showMessage(`画面比例：${customRatio}`);
    });

    // 画质设置按钮：打开画质增强弹窗
    document.getElementById('qualityBtn')?.addEventListener('click', () => {
      this.showEnhanceModal();
    });

    document.getElementById('skipIntroInput')?.addEventListener('change', (e) => {
      this.skipIntroTime = parseInt((e.target as HTMLInputElement).value) || 0;
      this.savePlayerSetting('skipIntroTime', this.skipIntroTime);
      this.showMessage(`片头跳过时间已设置为 ${this.skipIntroTime} 秒`);
    });

    document.getElementById('skipOutroInput')?.addEventListener('change', (e) => {
      this.skipOutroTime = parseInt((e.target as HTMLInputElement).value) || 0;
      this.savePlayerSetting('skipOutroTime', this.skipOutroTime);
      this.showMessage(`片尾跳过时间已设置为 ${this.skipOutroTime} 秒`);
    });

    document.getElementById('minimizeBtn')?.addEventListener('click', () => this.minimizeWindow());
    document.getElementById('maximizeBtn')?.addEventListener('click', () => this.toggleMaximize());
    document.getElementById('closeBtn')?.addEventListener('click', () => this.closeWindow());

    document.getElementById('retryBtn')?.addEventListener('click', () => {
      this.hideError();
      this.playEpisode(this.currentEpisode);
      this.showMessage('正在重新加载视频...');
    });

    const settingsPanel = document.getElementById('settingsPanel');
    settingsPanel?.addEventListener('mouseenter', () => {
      this.isSettingsPanelVisible = true;
      // 清除可能存在的延迟隐藏定时器（鼠标重新进入面板时取消隐藏）
      if (this.settingsHideTimer) {
        clearTimeout(this.settingsHideTimer);
        this.settingsHideTimer = null;
      }
      if (this.controlsTimeout) {
        clearTimeout(this.controlsTimeout);
        this.controlsTimeout = null;
      }
    });
    settingsPanel?.addEventListener('mouseleave', () => {
      // 清除上一个定时器避免堆积
      if (this.settingsHideTimer) clearTimeout(this.settingsHideTimer);
      this.settingsHideTimer = setTimeout(() => {
        this.settingsHideTimer = null;
        const settingsContainer = document.getElementById('settingsContainer');
        // 桥接区已覆盖间隙，此处再校验容器是否 hovered 作为最终保险
        if (settingsContainer && !settingsContainer.matches(':hover')) {
          this.hideSettings();
        }
      }, 300);
    });

    const playerContainer = document.getElementById('playerContainer');
    playerContainer?.addEventListener('mousemove', () => this.handleMouseMove());
    // 初始化 AbortController，统一管理 document 级事件监听
    this.eventAbortController = new AbortController();
    const signal = this.eventAbortController.signal;
    document.addEventListener('mousemove', () => this.handleMouseMove(), { signal });
    document.addEventListener('keydown', (e) => this.handleKeyboard(e), { signal });

    this.video.addEventListener('click', () => this.togglePlay());
    document.getElementById('kamposCanvas')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('centerPlayBtn')?.addEventListener('click', () => this.togglePlay());

    this.video.addEventListener('dblclick', () => {
      if (this.autoFullscreen) this.toggleFullscreen();
    });
    document.getElementById('kamposCanvas')?.addEventListener('dblclick', () => {
      if (this.autoFullscreen) this.toggleFullscreen();
    });

    this.video.addEventListener('contextmenu', (e) => this.showContextMenu(e));
    document.getElementById('kamposCanvas')?.addEventListener('contextmenu', (e) => this.showContextMenu(e));
    document.addEventListener('click', () => this.hideContextMenu(), { signal });

    // 屏蔽播放器窗口原生右键菜单：视频/画布上显示自定义菜单，其余区域仅阻止默认行为并隐藏自定义菜单
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = e.target as Node | null;
      const canvas = document.getElementById('kamposCanvas');
      const isVideoOrCanvas = !!target && (target === this.video || target === canvas);
      if (!isVideoOrCanvas) {
        this.hideContextMenu();
      }
    }, { signal });

    document.getElementById('closePlaybackInfo')?.addEventListener('click', () => this.hidePlaybackInfoPanel());
    document.getElementById('closeEnhanceModal')?.addEventListener('click', () => this.hideEnhanceModal());
  }

  /** 绑定 IPC 事件 */
  bindIpcEvents(): void {
    if (window.PLAYER) {
      window.PLAYER.on('player-close', () => this.closeWindow());
      window.PLAYER.on('player-pause', () => {
        if (this.video && !this.video.paused) this.video.pause();
      });
    }
  }

  /** 加载视频数据并解析剧集 */
  loadVideoData(): void {
    if (!this.videoData) return;
    const videoTitle = document.getElementById('videoTitle');
    const videoSubtitle = document.getElementById('videoSubtitle');
    const playUrl = this.videoData.vod_play_url || this.videoData.video?.vod_play_url;

    // 统一设置标题（无论走哪个分支）
    if (videoTitle) {
      videoTitle.textContent = this.videoData.vod_name || this.videoData.title || this.videoData.video?.vod_name || '视频标题';
    }

    if (playUrl) {
      const parsed = parsePlayUrl(playUrl) as { m3u8: EpisodeItem[]; mp4: EpisodeItem[]; iframe: EpisodeItem[]; live: EpisodeItem[] };
      this.episodesByFormat = parsed;
      this.determineCurrentFormat();
      this.episodes = this.episodesByFormat[this.currentFormat] || [];

      if (videoSubtitle && this.episodes[0]) {
        videoSubtitle.textContent = this.episodes[0].title || '';
      }

      this.renderPlaylistTabs();
      this.renderEpisodeList();
      this.updatePlaylistButtonVisibility();

      const episodeIndex = this.videoData.episodeIndex ?? this.videoData.currentEpisode ?? 0;
      this.checkAndRestoreHistory(episodeIndex).then((historyInfo) => {
        if (historyInfo && historyInfo.isSameEpisode) {
          this.playEpisode(episodeIndex, historyInfo);
        } else {
          this.playEpisode(episodeIndex);
        }
      });
    } else if (this.videoData.episodes && this.videoData.episodes.length > 0) {
      // 没有 vod_play_url，但有 episodes 数组（来自 Detail.tsx / 直播等场景）
      // 直播类型（type === 'live'）：所有剧集归入 live 桶，使用 HLS 播放并显示 live 指示
      const isLive = this.videoData.type === 'live';
      const parsedEpisodes = this.videoData.episodes.map((ep) => ({
        title: ep.title,
        url: ep.url,
        type: (isLive ? 'live' : this.determineUrlType(ep.url)) as SourceType,
      }));
      // 按 type 分组到 episodesByFormat
      this.episodesByFormat = { m3u8: [], mp4: [], iframe: [], live: [] };
      parsedEpisodes.forEach((ep) => {
        this.episodesByFormat[ep.type].push(ep);
      });
      // 直播类型强制使用 live 格式
      if (isLive) {
        this.currentFormat = 'live';
      } else {
        this.determineCurrentFormat();
      }
      this.episodes = this.episodesByFormat[this.currentFormat] || [];

      if (videoSubtitle && this.episodes[0]) {
        videoSubtitle.textContent = this.episodes[0].title || '';
      }

      // 直播模式：主标题显示频道名，副标题显示"电视直播"
      if (this.videoData.type === 'live') {
        if (videoTitle) videoTitle.textContent = this.episodes[0]?.title || this.videoData.vod_name || '电视直播';
        if (videoSubtitle) videoSubtitle.textContent = this.videoData.vod_name || '电视直播';
      }

      this.renderPlaylistTabs();
      this.renderEpisodeList();
      this.updatePlaylistButtonVisibility();

      const episodeIndex = this.videoData.episodeIndex ?? this.videoData.currentEpisode ?? 0;
      this.checkAndRestoreHistory(episodeIndex).then((historyInfo) => {
        if (historyInfo && historyInfo.isSameEpisode) {
          this.playEpisode(episodeIndex, historyInfo);
        } else {
          this.playEpisode(episodeIndex);
        }
      });
    }
  }

  /** 根据 URL 判断播放源类型 */
  private determineUrlType(url: string): SourceType {
    if (!url) return 'iframe';
    const cleanUrl = url.toLowerCase().split('?')[0];
    if (cleanUrl.includes('.m3u8') || cleanUrl.includes('.m3u')) return 'm3u8';
    if (cleanUrl.includes('.mp4') || cleanUrl.includes('.webm') || cleanUrl.includes('.avi') || cleanUrl.includes('.mov') || cleanUrl.includes('.mkv') || cleanUrl.includes('.flv')) return 'mp4';
    if (cleanUrl.includes('rtmp://') || cleanUrl.includes('rtsp://')) return 'mp4';
    return 'iframe';
  }

  /** 确定当前播放格式 */
  private determineCurrentFormat(): void {
    const formats: SourceType[] = ['live', 'm3u8', 'mp4', 'iframe'];
    if (this.episodesByFormat[this.currentFormat] && this.episodesByFormat[this.currentFormat].length > 0) return;
    for (const format of formats) {
      if (this.episodesByFormat[format] && this.episodesByFormat[format].length > 0) {
        this.currentFormat = format;
        return;
      }
    }
  }

  /** 渲染播放列表选项卡 */
  renderPlaylistTabs(): void {
    const tabsContainer = document.getElementById('playlistTabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    let hasVisibleTabs = false;
    (Object.keys(this.episodesByFormat) as SourceType[]).forEach((format) => {
      const episodes = this.episodesByFormat[format];
      if (!episodes || episodes.length === 0) return;
      hasVisibleTabs = true;

      const tab = document.createElement('div');
      tab.className = `playlist-tab ${format === this.currentFormat ? 'active' : ''}`;
      tab.dataset.format = format;
      tab.textContent = SOURCE_TYPE_NAMES[format];

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(episodes.length);
      tab.appendChild(badge);

      tab.addEventListener('click', () => this.switchFormat(format));
      tabsContainer.appendChild(tab);
    });

    const playlistContent = document.getElementById('playlistContent');
    if (!hasVisibleTabs) {
      tabsContainer.style.display = 'none';
      if (playlistContent) playlistContent.style.height = 'calc(100% - 70px)';
    } else {
      tabsContainer.style.display = 'flex';
      if (playlistContent) playlistContent.style.height = 'calc(100% - 120px)';
    }
  }

  /** 渲染剧集列表 */
  renderEpisodeList(): void {
    const listContainer = document.getElementById('playlistContent');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (this.episodes.length === 0) {
      listContainer.innerHTML = '<div class="no-episodes"><p>暂无剧集</p></div>';
      return;
    }

    this.episodes.forEach((episode, index) => {
      const item = document.createElement('div');
      item.className = `episode-item ${index === this.currentEpisode ? 'active' : ''}`;
      item.innerHTML = `
        <div class="episode-index">${index + 1}</div>
        <div class="episode-content">
          <div class="episode-title">${episode.title}</div>
        </div>
      `;
      item.addEventListener('click', () => {
        this.playEpisode(index);
        this.toggleEpisodeList();
      });
      listContainer.appendChild(item);
    });

    // 面板已展开时，滚动到当前播放剧集
    const panel = document.getElementById('playlistPanel');
    if (panel && panel.classList.contains('active')) {
      this.scrollToActiveEpisode();
    }
  }

  /** 滚动到当前播放剧集，确保在列表中可见 */
  private scrollToActiveEpisode(): void {
    const listContainer = document.getElementById('playlistContent');
    if (!listContainer) return;
    const activeItem = listContainer.querySelector('.episode-item.active') as HTMLElement | null;
    if (!activeItem) return;
    activeItem.scrollIntoView({ block: 'center' });
  }

  /** 切换播放格式 */
  switchFormat(format: SourceType): void {
    if (format === this.currentFormat) return;
    this.cleanupPreviousPlayer();
    this.currentFormat = format;
    this.episodes = this.episodesByFormat[format] || [];
    this.currentEpisode = 0;

    document.querySelectorAll('.playlist-tab').forEach((tab) => {
      if ((tab as HTMLElement).dataset.format === format) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    this.renderEpisodeList();
    if (this.episodes.length > 0) this.playEpisode(0);
  }

  /** 清理前一个播放器 */
  private cleanupPreviousPlayer(): void {
    if (this.hls) {
      (this.hls as { destroy: () => void }).destroy();
      this.hls = null;
    }
    const iframePlayer = document.getElementById('iframePlayer') as HTMLIFrameElement;
    if (iframePlayer) {
      iframePlayer.onload = null;
      iframePlayer.src = '';
    }
    this.isPlaying = false;
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
      this.controlsTimeout = null;
    }
  }

  /** 更新剧集列表按钮可见性 */
  updatePlaylistButtonVisibility(): void {
    const playlistBtn = document.getElementById('playlistBtn');
    const playlistBtnTop = document.getElementById('playlistBtnTop');
    if (!playlistBtn || !playlistBtnTop) return;

    let totalEpisodes = 0;
    let formatCount = 0;
    (Object.keys(this.episodesByFormat) as SourceType[]).forEach((format) => {
      const episodes = this.episodesByFormat[format];
      if (episodes && episodes.length > 0) {
        totalEpisodes += episodes.length;
        formatCount++;
      }
    });

    if (formatCount === 1 && totalEpisodes === 1) {
      playlistBtn.style.display = 'none';
      playlistBtnTop.style.display = 'none';
    } else {
      playlistBtn.style.display = 'flex';
      playlistBtnTop.style.display = this.currentFormat === 'iframe' ? 'flex' : 'none';
    }
  }

  /** 播放指定剧集 */
  playEpisode(index: number, historyInfo: { isSameEpisode: boolean; isCompleted: boolean } | null = null): void {
    if (index < 0 || index >= this.episodes.length) return;

    this.currentEpisode = index;
    const episode = this.episodes[index];

    const videoSubtitle = document.getElementById('videoSubtitle');
    if (videoSubtitle) videoSubtitle.textContent = episode.title || '';

    // 直播模式：切台时主标题更新为当前频道名，副标题保持"电视直播"
    if (this.videoData.type === 'live') {
      const videoTitle = document.getElementById('videoTitle');
      if (videoTitle) videoTitle.textContent = episode.title || this.videoData.vod_name || '电视直播';
      if (videoSubtitle) videoSubtitle.textContent = this.videoData.vod_name || '电视直播';
    }

    this.renderEpisodeList();
    this.updateUI();
    // 切换直播模式 UI（live 格式隐藏进度条/上一集/下一集/音量/时间，显示 live 指示）
    this.applyLiveMode(this.currentFormat === 'live');

    const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
    const iframePlayer = document.getElementById('iframePlayer') as HTMLIFrameElement;

    if (!episode.url) {
      this.showError('播放地址为空');
      return;
    }

    if (this.currentFormat === 'iframe') {
      if (videoPlayer) videoPlayer.style.display = 'none';
      if (iframePlayer) {
        // 显示封面图作为加载占位，iframe 加载完成后隐藏
        const poster = document.getElementById('iframePoster') as HTMLDivElement | null;
        const posterImg = document.getElementById('iframePosterImg') as HTMLImageElement | null;
        const posterUrl = this.videoData.pic || this.videoData.video?.vod_pic || '';
        if (poster && posterImg && posterUrl) {
          posterImg.src = posterUrl;
          poster.style.display = 'block';
        } else if (poster) {
          poster.style.display = 'none';
        }

        iframePlayer.style.display = 'block';
        // 先清除旧的事件处理器和 src
        iframePlayer.onload = null;
        iframePlayer.onerror = null;
        iframePlayer.src = episode.url;
        // 加载成功后隐藏 loading 和封面图，更新状态
        iframePlayer.onload = () => {
          this.isPlaying = true;
          this.updateUI();
          this.showLoading(false);
          if (poster) poster.style.display = 'none';
        };
        // 加载失败时显示错误提示并隐藏封面图
        iframePlayer.onerror = () => {
          this.showError('iframe 内容加载失败，可能是跨域限制或地址无效');
          if (poster) poster.style.display = 'none';
        };
      }
      // 显示 loading（spinner 覆盖在封面图上方），让用户看到加载状态
      this.showLoading(true);
      const centerPlayBtn = document.getElementById('centerPlayBtn');
      if (centerPlayBtn) centerPlayBtn.style.display = 'none';
      this.showHeaderOnly();
      this.handleHistoryRestore(historyInfo);
    } else if (this.currentFormat === 'mp4') {
      if (iframePlayer) iframePlayer.style.display = 'none';
      if (videoPlayer) {
        videoPlayer.style.display = 'block';
        videoPlayer.poster = this.videoData.pic || this.videoData.video?.vod_pic || '';
      }
      this.showLoading(true);
      if (this.hls) {
        (this.hls as { destroy: () => void }).destroy();
        this.hls = null;
      }
      if (videoPlayer) {
        videoPlayer.src = episode.url;
        videoPlayer.load();
        videoPlayer.volume = this.volume;
      }
      this.showControls();
      this.handleHistoryRestore(historyInfo);
    } else if (this.currentFormat === 'm3u8' || this.currentFormat === 'live') {
      // live 与 m3u8 均通过 HLS 加载；live 模式下 UI 由 applyLiveMode 控制
      if (iframePlayer) iframePlayer.style.display = 'none';
      if (videoPlayer) {
        videoPlayer.style.display = 'block';
        videoPlayer.poster = this.videoData.pic || this.videoData.video?.vod_pic || '';
      }
      this.showLoading(true);
      this.loadHlsSource(episode.url).then(() => {
        this.handleHistoryRestore(historyInfo);
      });
    }
  }

  /**
   * 切换直播模式 UI
   * live 格式：隐藏进度条、上一集/下一集、音量、时间显示；显示 live 指示
   * 非 live 格式：恢复全部控件
   * @param live - 是否为直播模式
   */
  private applyLiveMode(live: boolean): void {
    const container = document.getElementById('playerContainer');
    const liveIndicator = document.getElementById('liveIndicator');
    const progressContainer = document.getElementById('progressContainer');

    if (live) {
      container?.classList.add('live-mode');
      if (liveIndicator) liveIndicator.style.display = 'flex';
      if (progressContainer) progressContainer.style.display = 'none';
    } else {
      container?.classList.remove('live-mode');
      if (liveIndicator) liveIndicator.style.display = 'none';
      if (progressContainer) progressContainer.style.display = '';
    }
  }

  /** 加载 HLS 源 */
  async loadHlsSource(url: string): Promise<void> {
    if (!window.Hls) {
      this.showError('HLS 播放器未加载');
      return;
    }

    // 重置重试计数器，避免跨源重试次数累积
    this.retryCount = 0;

    const videoPlayer = this.video!;
    if (this.hls) {
      (this.hls as { destroy: () => void }).destroy();
      this.hls = null;
    }

    // 加速代理：优先通过本地代理加载，失败则降级为直连原始地址
    // 直播流使用直连，不走加速代理（直播源通常为短连接，代理反而增加延迟）
    const actualUrl = this.currentFormat === 'live' ? url : await this.resolveBoostedUrl(url);

    const HlsConstructor = window.Hls as unknown as {
      new (config?: Record<string, unknown>): {
        loadSource: (url: string) => void;
        attachMedia: (video: HTMLVideoElement) => void;
        on: (event: string, callback: (...args: unknown[]) => void) => void;
        destroy: () => void;
        startLoad: () => void;
        recoverMediaError: () => void;
      };
      isSupported: () => boolean;
      Events: { MANIFEST_PARSED: string; ERROR: string };
      ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
    };

    if (HlsConstructor.isSupported()) {
      // 以环境基础配置为底，使用用户设置覆盖可配置项，确保设置面板的 HLS 配置生效
      const baseConfig = import.meta.env.PROD ? PRODUCTION_HLS_CONFIG : DEVELOPMENT_HLS_CONFIG;
      const hlsConfig = {
        ...baseConfig,
        enableWorker: this.hlsEnableWorker,
        enableSoftwareAES: this.hlsEnableSoftwareAES,
        maxBufferSize: this.hlsMaxBufferSize,
        maxBufferLength: this.hlsMaxBufferLength,
      };
      const hlsInstance = new HlsConstructor(hlsConfig);
      this.hls = hlsInstance;
      hlsInstance.loadSource(actualUrl);
      hlsInstance.attachMedia(videoPlayer);

      hlsInstance.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
        videoPlayer.volume = this.volume;
        videoPlayer.playbackRate = this.playbackRate;
        if (this.autoplay) videoPlayer.play().catch(() => undefined);
      });

      hlsInstance.on(HlsConstructor.Events.ERROR, (_event: unknown, data: unknown) => {
        const errorData = data as { fatal: boolean; type: string; details: string };
        if (errorData.fatal) {
          if (errorData.details && errorData.details.includes('CORS')) {
            this.showError('视频源跨域限制，请检查服务器CORS配置');
            return;
          }
          switch (errorData.type) {
            case HlsConstructor.ErrorTypes.NETWORK_ERROR:
              if (this.retryCount < 3) {
                this.retryCount++;
                setTimeout(() => hlsInstance.startLoad(), 1000 * this.retryCount);
              } else {
                this.showError('网络错误，无法加载视频');
              }
              break;
            case HlsConstructor.ErrorTypes.MEDIA_ERROR:
              if (this.retryCount < 2) {
                this.retryCount++;
                hlsInstance.recoverMediaError();
              } else {
                this.showError('媒体解码失败，可能是不支持的视频格式');
              }
              break;
            default:
              // 处理 manifest 解析失败、密钥加载失败等不可恢复错误
              if (errorData.details === 'manifestParseError') {
                this.showError('播放列表解析失败，请检查视频地址是否有效');
              } else if (errorData.details === 'keyLoadError') {
                this.showError('视频解密密钥加载失败，可能需要授权');
              } else if (errorData.details === 'keySystemStatusOutputRestricted') {
                this.showError('视频受 DRM 保护，无法播放');
              } else {
                this.showError('视频加载失败: ' + (errorData.details || '未知错误'));
              }
              // 不可恢复的错误，停止加载避免无限重试
              hlsInstance.destroy();
              this.hls = null;
              break;
          }
        }
      });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      videoPlayer.src = actualUrl;
      videoPlayer.load();
      videoPlayer.volume = this.volume;
      if (this.autoplay) videoPlayer.play().catch(() => undefined);
    } else {
      this.showError('浏览器不支持HLS播放');
    }
    this.showControls();
  }

  /**
   * 解析加速代理 URL
   * - boostEnabled 为 false 时直接返回原始 URL
   * - API.proxy 不可用或调用失败时降级为原始 URL
   * - 成功则记录 sessionId 并返回本地代理 playUrl
   * - 切换剧集前主动销毁旧会话，避免会话泄露
   * @param originalUrl 原始 m3u8 地址
   * @returns 实际加载的 URL（本地代理 URL 或原始 URL）
   */
  private async resolveBoostedUrl(originalUrl: string): Promise<string> {
    // 切换剧集前主动销毁上一个加速会话，避免会话累积泄露
    await this.destroyProxySession();
    if (!this.boostEnabled) return originalUrl;
    if (!window.API?.proxy?.boost) return originalUrl;
    try {
      const r = await window.API.proxy.boost(originalUrl);
      if (r.ok && r.playUrl) {
        this.proxySessionId = r.sessionId || null;
        return r.playUrl;
      }
      // 降级：使用原始地址直连
      console.warn('[VideoPlayer] 加速代理不可用，降级为直连:', r.error);
      return originalUrl;
    } catch (e) {
      console.warn('[VideoPlayer] 加速代理调用异常，降级为直连:', e);
      return originalUrl;
    }
  }

  /**
   * 销毁当前加速代理会话（若存在）
   * 调用 IPC 通知主进程清理会话资源（内存缓存 + 磁盘缓存）
   */
  private async destroyProxySession(): Promise<void> {
    const sid = this.proxySessionId;
    this.proxySessionId = null;
    if (!sid) return;
    if (!window.API?.proxy?.expire) return;
    try {
      await window.API.proxy.expire(sid);
    } catch (e) {
      console.warn('[VideoPlayer] 销毁加速会话失败:', e);
    }
  }

  /** 播放上一集 */
  playPrevious(): void {
    if (this.currentEpisode > 0) {
      this.playEpisode(this.currentEpisode - 1);
      this.showMessage(`正在播放：${this.episodes[this.currentEpisode]?.title || ''}`);
    }
  }

  /** 播放下一集 */
  playNext(): void {
    if (this.currentEpisode < this.episodes.length - 1) {
      this.playEpisode(this.currentEpisode + 1);
      this.showMessage(`正在播放：${this.episodes[this.currentEpisode]?.title || ''}`);
    }
  }

  /** 切换播放/暂停 */
  togglePlay(): void {
    if (!this.video) return;
    if (this.video.paused) this.video.play().catch(() => undefined);
    else this.video.pause();
  }

  /** 返回 */
  goBack(): void {
    this.closeWindow();
  }

  /** 切换全屏 */
  async toggleFullscreen(): Promise<void> {
    if (window.API?.player) {
      try {
        const result = await window.API.player.toggleFullscreen() as { success: boolean; isFullscreen: boolean };
        if (result.success) {
          this.isFullscreen = result.isFullscreen;
          this.updateFullscreenIcon();
          this.showMessage(this.isFullscreen ? '已进入全屏' : '已退出全屏');
        }
      } catch (error) {
        console.warn('[VideoPlayer] 切换全屏失败:', error);
      }
    }
  }

  /** 更新全屏图标 */
  private updateFullscreenIcon(): void {
    const btn = document.getElementById('fullscreenBtn');
    if (btn) {
      btn.innerHTML = this.isFullscreen
        ? '<svg class="icon" viewBox="0 0 24 24" width="20" height="20"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
        : '<svg class="icon" viewBox="0 0 24 24" width="20" height="20"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
    }
  }

  /** 切换静音 */
  toggleMute(): void {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    this.isMuted = this.video.muted;
    this.updateVolumeIcon();
    this.showMessage(this.isMuted ? '已静音' : '已取消静音');
  }

  /** 保存播放器设置 */
  private async savePlayerSetting(key: string, value: unknown): Promise<void> {
    if (window.API?.settings) {
      try {
        await window.API.settings.set(`player.${key}`, value);
      } catch (e) {
        console.warn('[VideoPlayer] 保存设置失败:', e);
      }
    }
  }

  /** 设置音量 */
  setVolume(value: number): void {
    if (!this.video) return;
    this.video.volume = value;
    this.video.muted = value === 0;
    this.volume = value;
    this.isMuted = value === 0;
    this.updateVolumeIcon();
    this.updateVolumeSlider(value);
    if (this.volumeSaveTimer) clearTimeout(this.volumeSaveTimer);
    this.volumeSaveTimer = setTimeout(() => {
      this.savePlayerSetting('volume', Math.round(value * 100));
    }, 500);
  }

  /** 更新音量滑块 */
  private updateVolumeSlider(value: number): void {
    const volumeRange = document.getElementById('volumeRange') as HTMLInputElement;
    if (volumeRange) volumeRange.value = String(Math.round(value * 100));
  }

  /** 更新音量图标 */
  private updateVolumeIcon(): void {
    const btn = document.getElementById('volumeBtn');
    if (!btn || !this.video) return;
    const volume = this.video.volume;
    const muted = this.video.muted;
    let iconHtml: string;
    if (muted || volume === 0) {
      iconHtml = '<svg class="icon" viewBox="0 0 24 24" width="20" height="20"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/></svg>';
    } else if (volume < 0.5) {
      iconHtml = '<svg class="icon" viewBox="0 0 24 24" width="20" height="20"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
    } else {
      iconHtml = '<svg class="icon" viewBox="0 0 24 24" width="20" height="20"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
    }
    btn.innerHTML = iconHtml;
  }

  /** 设置播放速度 */
  setPlaybackRate(rate: number): void {
    if (!this.video) return;
    this.playbackRate = rate;
    this.video.playbackRate = rate;
    this.savePlayerSetting('speed', rate);
  }

  /** 设置旋转 */
  setRotation(rotation: number): void {
    this.currentRotation = rotation;
    this.applyVideoLayout();
  }

  /** 设置画面比例 */
  setAspectRatio(ratio: string): void {
    this.currentAspectRatio = ratio;
    this.applyVideoLayout();
    // 持久化（auto/stretch/16:9/4:3/自定义均保存）
    this.savePlayerSetting('aspectRatio', ratio);
  }

  /**
   * 统一应用视频布局（画面比例 + 旋转）
   * 根据当前画面比例与旋转角度，计算视频/Canvas 的显示尺寸与变换。
   * - auto：保持原始比例 contain 适配
   * - stretch：填满播放器（fill）
   * - 指定比例（16:9/4:3/自定义）：以一边为基础计算目标比例矩形，确保不超出播放器
   * - 旋转 90/270 时有效宽高互换，矩形计算基于互换后的尺寸
   * @returns {void}
   */
  private applyVideoLayout(): void {
    if (!this.video) return;
    const canvas = document.getElementById('kamposCanvas') as HTMLElement | null;
    const videoArea = document.getElementById('videoArea');

    const rotation = this.currentRotation;
    const ratio = this.currentAspectRatio;
    const isVertical = rotation === 90 || rotation === 270;

    const areaW = videoArea?.clientWidth || window.innerWidth;
    const areaH = videoArea?.clientHeight || window.innerHeight;
    // 旋转 90/270 时有效宽高互换
    const effectiveW = isVertical ? areaH : areaW;
    const effectiveH = isVertical ? areaW : areaH;

    const applyTo = (el: HTMLElement): void => {
      // 重置内联样式
      el.style.objectFit = '';
      el.style.width = '';
      el.style.height = '';
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.transform = '';

      let useAbsoluteCentering = false;

      if (ratio === 'stretch') {
        // 拉伸：填满播放器
        if (isVertical) {
          el.style.width = areaH + 'px';
          el.style.height = areaW + 'px';
          useAbsoluteCentering = true;
        } else {
          el.style.width = '100%';
          el.style.height = '100%';
        }
        el.style.objectFit = 'fill';
      } else if (ratio === 'auto') {
        // 默认：保持原始比例 contain
        if (isVertical) {
          el.style.width = areaH + 'px';
          el.style.height = areaW + 'px';
          useAbsoluteCentering = true;
        } else {
          el.style.width = '100%';
          el.style.height = '100%';
        }
        el.style.objectFit = 'contain';
      } else {
        // 指定比例：解析 W:H
        const parts = ratio.split(':');
        if (parts.length !== 2) return;
        const targetW = parseFloat(parts[0]);
        const targetH = parseFloat(parts[1]);
        if (!targetW || !targetH || targetH <= 0) return;
        const targetRatio = targetW / targetH;

        // 以一边为基础计算目标比例矩形，不超出播放器
        const containerRatio = effectiveW / effectiveH;
        let displayW: number;
        let displayH: number;
        if (containerRatio > targetRatio) {
          // 容器更宽：以高度为基础，宽度按比例计算
          displayH = effectiveH;
          displayW = displayH * targetRatio;
        } else {
          // 容器更高：以宽度为基础，高度按比例计算
          displayW = effectiveW;
          displayH = displayW / targetRatio;
        }

        el.style.width = displayW + 'px';
        el.style.height = displayH + 'px';
        el.style.objectFit = 'fill';
        useAbsoluteCentering = true;
      }

      // 应用居中定位与旋转变换
      if (useAbsoluteCentering) {
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transform = rotation !== 0
          ? `translate(-50%, -50%) rotate(${rotation}deg)`
          : 'translate(-50%, -50%)';
      } else if (rotation !== 0) {
        el.style.transform = `rotate(${rotation}deg)`;
      }
    };

    applyTo(this.video);
    if (canvas) applyTo(canvas);
  }

  /** 切换设置面板 */
  toggleSettings(): void {
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsBtn = document.getElementById('settingsBtn');
    if (!settingsPanel || !settingsBtn) return;
    if (settingsPanel.style.visibility === 'visible') {
      this.hideSettings();
    } else {
      settingsPanel.style.visibility = 'visible';
      settingsPanel.style.opacity = '1';
      settingsBtn.classList.add('active');
      this.isSettingsPanelVisible = true;
      this.showControls();
      if (this.controlsTimeout) {
        clearTimeout(this.controlsTimeout);
        this.controlsTimeout = null;
      }
    }
  }

  /** 隐藏设置面板 */
  hideSettings(): void {
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsBtn = document.getElementById('settingsBtn');
    if (!settingsPanel || !settingsBtn) return;
    settingsPanel.style.visibility = 'hidden';
    settingsPanel.style.opacity = '0';
    settingsBtn.classList.remove('active');
    this.isSettingsPanelVisible = false;
    if (this.settingsHideTimer) {
      clearTimeout(this.settingsHideTimer);
      this.settingsHideTimer = null;
    }
    if (this.video && !this.video.paused) this.showControls();
  }

  /** 切换剧集列表 */
  toggleEpisodeList(): void {
    const panel = document.getElementById('playlistPanel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('active');
    panel.classList.toggle('active');
    // 展开时等过渡动画结束再滚动到当前播放剧集，避免动画进行中触发 reflow 造成抖动
    if (willOpen) {
      const triggerScroll = (): void => {
        panel.removeEventListener('transitionend', onTransitionEnd);
        clearTimeout(fallbackTimer);
        this.scrollToActiveEpisode();
      };
      const onTransitionEnd = (e: TransitionEvent): void => {
        // 仅响应 transform 结束（避免 opacity 等其它属性提前触发）
        if (e.propertyName === 'transform') triggerScroll();
      };
      panel.addEventListener('transitionend', onTransitionEnd);
      // 兜底：transitionend 未触发时仍保证滚动（动画时长 200ms + 余量）
      const fallbackTimer = setTimeout(triggerScroll, 300);
    }
  }

  /** 切换沉浸模式 */
  toggleImmersiveMode(): void {
    if (this.isImmersiveMode) this.exitImmersiveMode();
    else this.enterImmersiveMode();
  }

  /** 进入沉浸模式 */
  enterImmersiveMode(): void {
    this.isImmersiveMode = true;
    const controls = document.getElementById('playerControls');
    const header = document.getElementById('playerHeader');
    const miniProgress = document.getElementById('miniProgressContainer');
    const playerContainer = document.getElementById('playerContainer');

    if (controls) {
      controls.style.opacity = '0';
      controls.style.pointerEvents = 'none';
    }
    if (header) {
      header.style.opacity = '0';
      header.style.pointerEvents = 'none';
    }
    if (miniProgress) miniProgress.classList.remove('visible');
    if (playerContainer) (playerContainer.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'drag';

    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
      this.controlsTimeout = null;
    }
    this.showMessage('已进入沉浸模式，按 ESC 退出');
    if (window.API?.player) window.API.player.setImmersiveMode(true);
  }

  /** 退出沉浸模式 */
  exitImmersiveMode(): void {
    this.isImmersiveMode = false;
    const playerContainer = document.getElementById('playerContainer');
    if (playerContainer) (playerContainer.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'no-drag';
    this.showControls();
    if (window.API?.player) window.API.player.setImmersiveMode(false);
  }

  /** 显示控制条 */
  showControls(): void {
    if (!this.showControlsEnabled || this.isDestroying) return;
    if (this.isImmersiveMode) return;

    this.showMouse();
    const controls = document.getElementById('playerControls');
    const header = document.getElementById('playerHeader');
    const miniProgress = document.getElementById('miniProgressContainer');

    if (header) {
      header.style.opacity = '1';
      header.style.pointerEvents = 'auto';
    }
    if (controls) {
      if (this.currentFormat === 'iframe') {
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none';
      } else {
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
        if (miniProgress) miniProgress.classList.remove('visible');
      }
    }
    if (this.controlsTimeout) clearTimeout(this.controlsTimeout);
    if (this.video && !this.video.paused && this.controlsHideDelay > 0) {
      this.controlsTimeout = setTimeout(() => this.hideControls(), this.controlsHideDelay);
    }
  }

  /** 只显示头部 */
  showHeaderOnly(): void {
    const controls = document.getElementById('playerControls');
    const header = document.getElementById('playerHeader');
    const miniProgress = document.getElementById('miniProgressContainer');
    if (controls) {
      controls.style.opacity = '0';
      controls.style.pointerEvents = 'none';
    }
    if (header) {
      header.style.opacity = '1';
      header.style.pointerEvents = 'auto';
    }
    if (miniProgress) miniProgress.classList.remove('visible');
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
      this.controlsTimeout = null;
    }
  }

  /** 隐藏控制条 */
  hideControls(): void {
    if (!this.video || this.video.paused) return;
    if (this.isSettingsPanelVisible) {
      if (this.controlsTimeout) clearTimeout(this.controlsTimeout);
      if (this.controlsHideDelay > 0) {
        this.controlsTimeout = setTimeout(() => this.hideControls(), Math.max(this.controlsHideDelay, 5000));
      }
      return;
    }
    const controls = document.getElementById('playerControls');
    const header = document.getElementById('playerHeader');
    const miniProgress = document.getElementById('miniProgressContainer');
    if (controls) {
      controls.style.opacity = '0';
      controls.style.pointerEvents = 'none';
    }
    if (header) {
      header.style.opacity = '0';
      header.style.pointerEvents = 'none';
    }
    if (miniProgress && this.currentFormat !== 'iframe' && this.currentFormat !== 'live') miniProgress.classList.add('visible');
    this.hideMouse();
    this.hideCenterPlayBtn();
  }

  /** 处理鼠标移动 */
  handleMouseMove(): void {
    if (this.isDestroying) return;
    this.lastMouseMoveTime = Date.now();
    this.showMouse();
    this.showControls();
    if (this.video && !this.video.paused) this.resetMouseHideTimer();
  }

  /** 显示鼠标 */
  private showMouse(): void {
    if (!this.isMouseVisible) {
      this.isMouseVisible = true;
      document.body.style.cursor = 'auto';
    }
  }

  /** 隐藏鼠标 */
  private hideMouse(): void {
    if (this.isMouseVisible) {
      this.isMouseVisible = false;
      document.body.style.cursor = 'none';
    }
  }

  /** 重置鼠标隐藏定时器 */
  private resetMouseHideTimer(): void {
    if (this.mouseTimeout) clearTimeout(this.mouseTimeout);
    this.mouseTimeout = setTimeout(() => {
      if (Date.now() - this.lastMouseMoveTime >= 3000) this.hideMouse();
    }, 3000);
  }

  /** 显示中心播放按钮 */
  private showCenterPlayBtn(): void {
    const btn = document.getElementById('centerPlayBtn');
    if (btn) btn.style.opacity = '1';
    if (this.centerPlayBtnTimeout) clearTimeout(this.centerPlayBtnTimeout);
    this.centerPlayBtnTimeout = setTimeout(() => this.hideCenterPlayBtn(), 3000);
  }

  /** 隐藏中心播放按钮 */
  private hideCenterPlayBtn(): void {
    const btn = document.getElementById('centerPlayBtn');
    if (btn) btn.style.opacity = '0';
  }

  /** 显示消息提示 */
  showMessage(text: string, actionText: string | null = null, actionCallback: (() => void) | null = null): void {
    const messageContainer = document.getElementById('messageContainer');
    if (!messageContainer) return;
    const existingMessage = messageContainer.querySelector('.message');
    if (existingMessage) existingMessage.remove();

    const message = document.createElement('div');
    message.className = 'message';
    const textSpan = document.createElement('span');
    textSpan.className = 'message-text';
    textSpan.textContent = text;
    message.appendChild(textSpan);

    if (actionText && actionCallback) {
      const actionSpan = document.createElement('span');
      actionSpan.className = 'message-action';
      actionSpan.textContent = actionText;
      actionSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        actionCallback();
        this.hideMessage();
      });
      message.appendChild(actionSpan);
    }

    message.addEventListener('click', () => this.hideMessage());
    messageContainer.appendChild(message);
    requestAnimationFrame(() => message.classList.add('show'));

    if (this.messageTimeout) clearTimeout(this.messageTimeout);
    this.messageTimeout = setTimeout(() => this.hideMessage(), 3000);
  }

  /** 隐藏消息提示 */
  private hideMessage(): void {
    const messageContainer = document.getElementById('messageContainer');
    if (!messageContainer) return;
    const message = messageContainer.querySelector('.message');
    if (message) {
      message.classList.remove('show');
      setTimeout(() => {
        if (message.parentNode) message.remove();
      }, 300);
    }
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }
  }

  /** 跳转到指定位置 */
  seekTo(event: MouseEvent): void {
    if (!this.video) return;
    const progressBar = document.getElementById('progressBar');
    if (!progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    this.video.currentTime = percent * this.video.duration;
    this.updateProgressHandlePosition(percent);
  }

  /** 迷你进度条跳转 */
  seekToMini(event: MouseEvent): void {
    if (!this.video) return;
    const miniProgress = document.getElementById('miniProgressContainer');
    if (!miniProgress) return;
    const rect = miniProgress.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.video.currentTime = percent * this.video.duration;
    this.updateProgressHandlePosition(percent);
  }

  /** 迷你进度条悬停 */
  private onMiniProgressHover(event: MouseEvent): void {
    const miniProgress = document.getElementById('miniProgressContainer');
    if (!miniProgress) return;
    const rect = miniProgress.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const hover = document.getElementById('miniProgressHover');
    if (hover) hover.style.width = `${percent * 100}%`;
  }

  /** 迷你进度条离开 */
  private onMiniProgressLeave(): void {
    const hover = document.getElementById('miniProgressHover');
    if (hover) hover.style.width = '0%';
  }

  /** 进度条悬停 */
  onProgressHover(event: MouseEvent): void {
    if (!this.video) return;
    const progressBar = document.getElementById('progressBar');
    if (!progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = percent * this.video.duration;
    const tooltip = document.getElementById('progressTimeTooltip');
    if (tooltip) {
      tooltip.textContent = this.formatTime(time);
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipLeft = percent * rect.width;
      const maxLeft = rect.width - tooltipWidth;
      const finalLeft = Math.min(Math.max(0, tooltipLeft - tooltipWidth / 2), maxLeft);
      tooltip.style.left = `${finalLeft + tooltipWidth / 2}px`;
      tooltip.style.transform = 'translateX(-50%)';
    }
    const hover = document.getElementById('progressHover');
    if (hover) hover.style.width = `${percent * 100}%`;
  }

  /** 更新进度条拖拽球位置 */
  private updateProgressHandlePosition(percent: number): void {
    const progressHandle = document.getElementById('progressHandle');
    if (progressHandle) {
      progressHandle.style.left = `${percent * 100}%`;
      progressHandle.style.display = 'block';
    }
  }

  /** 开始进度条拖拽 */
  startProgressDrag(event: MouseEvent): void {
    event.preventDefault();
    this.isDraggingProgress = true;
    const handleMouseMove = (e: MouseEvent) => {
      if (!this.isDraggingProgress || !this.video) return;
      const progressBar = document.getElementById('progressBar');
      if (!progressBar) return;
      const rect = progressBar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.video.currentTime = percent * this.video.duration;
      this.updateProgressHandlePosition(percent);
      const tooltip = document.getElementById('progressTimeTooltip');
      if (tooltip) tooltip.textContent = this.formatTime(percent * this.video.duration);
      const hover = document.getElementById('progressHover');
      if (hover) hover.style.width = `${percent * 100}%`;
    };
    const handleMouseUp = () => {
      this.isDraggingProgress = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    handleMouseMove(event);
  }

  /** 处理键盘事件 */
  handleKeyboard(event: KeyboardEvent): void {
    if (this.isDestroying || !this.video) return;
    if (event.target instanceof HTMLInputElement) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.togglePlay();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.video.currentTime = Math.max(0, this.video.currentTime - this.skipStep);
        this.showMessage(`后退${this.skipStep}秒`);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + this.skipStep);
        this.showMessage(`前进${this.skipStep}秒`);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.setVolume(Math.min(1, this.video.volume + this.volumeStep));
        this.showMessage(`音量：${Math.round(this.video.volume * 100)}%`);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.setVolume(Math.max(0, this.video.volume - this.volumeStep));
        this.showMessage(`音量：${Math.round(this.video.volume * 100)}%`);
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'Escape':
        if (this.isImmersiveMode) {
          if (this.isFullscreen) this.toggleFullscreen();
          else this.exitImmersiveMode();
        } else if (this.isFullscreen) {
          this.toggleFullscreen();
        }
        break;
    }
  }

  /** 视频元数据加载完成 */
  onMetadataLoaded(): void {
    if (!this.video) return;
    const duration = document.getElementById('duration');
    if (duration) duration.textContent = this.formatTime(this.video.duration);
    if (this.kamposEnhanced && this.kamposInstance) {
      const inst = this.kamposInstance as {
        setSource: (opts: { media: HTMLVideoElement; width: number; height: number }) => void;
        play: () => void;
      };
      inst.setSource({ media: this.video, width: this.video.videoWidth, height: this.video.videoHeight });
      this._updateDeblockTexelSize();
      inst.play();
    }
  }

  /** 时间更新 */
  onTimeUpdate(): void {
    if (!this.video || this.currentFormat === 'iframe') return;
    const currentTime = this.video.currentTime;
    const duration = this.video.duration;

    const currentTimeEl = document.getElementById('currentTime');
    if (currentTimeEl) currentTimeEl.textContent = this.formatTime(currentTime);

    // 直播流 duration 为 Infinity，无法计算进度，跳过进度条与片头片尾逻辑
    if (Number.isFinite(duration) && duration > 0) {
      const progressPercent = (currentTime / duration) * 100;
      const played = document.getElementById('progressPlayed');
      if (played) played.style.width = `${progressPercent}%`;
      const miniPlayed = document.getElementById('miniProgressPlayed');
      if (miniPlayed) miniPlayed.style.width = `${progressPercent}%`;
      this.updateProgressHandlePosition(currentTime / duration);

      if (this.skipIntroTime > 0 && currentTime < this.skipIntroTime && currentTime > 0) {
        this.video.currentTime = this.skipIntroTime;
        this.showMessage('已跳过片头', '从头播放', () => { if (this.video) this.video.currentTime = 0; });
      }

      if (this.skipOutroTime > 0 && currentTime > duration - this.skipOutroTime && currentTime < duration) {
        this.video.currentTime = duration;
        this.showMessage('已跳过片尾', '重新播放', () => { if (this.video) { this.video.currentTime = 0; this.video.play(); } });
      }
    }

    if (!this.lastHistorySaveTime || Date.now() - this.lastHistorySaveTime >= this.historySaveInterval) {
      this.saveHistoryRecord();
      this.lastHistorySaveTime = Date.now();
    }
  }

  /** 缓冲进度 */
  onProgress(): void {
    if (!this.video || this.currentFormat === 'iframe') return;
    if (this.video.buffered.length > 0) {
      const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
      const duration = this.video.duration;
      if (duration > 0) {
        const bufferPercent = (bufferedEnd / duration) * 100;
        const loaded = document.getElementById('progressLoaded');
        if (loaded) loaded.style.width = `${bufferPercent}%`;
        const miniLoaded = document.getElementById('miniProgressLoaded');
        if (miniLoaded) miniLoaded.style.width = `${bufferPercent}%`;
      }
    }
  }

  /** 播放事件 */
  onPlay(): void {
    if (!this.video || this.currentFormat === 'iframe') return;
    this.isPlaying = true;
    const btn = document.getElementById('playPauseBtn');
    if (btn) btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" width="24" height="24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>';
    this.showControls();
    this.hideCenterPlayBtn();
    this.resetMouseHideTimer();
    if (window.PLAYER) window.PLAYER.send('player-playback-changed', true);
    if (this.kamposEnhanced && this.kamposInstance) {
      (this.kamposInstance as { play: () => void }).play();
    }
  }

  /** 暂停事件 */
  onPause(): void {
    if (!this.video || this.currentFormat === 'iframe') return;
    this.isPlaying = false;
    const btn = document.getElementById('playPauseBtn');
    if (btn) btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" width="24" height="24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>';
    const controls = document.getElementById('playerControls');
    const header = document.getElementById('playerHeader');
    const miniProgress = document.getElementById('miniProgressContainer');
    if (controls) {
      controls.style.opacity = '1';
      controls.style.pointerEvents = 'auto';
    }
    if (header) {
      header.style.opacity = '1';
      header.style.pointerEvents = 'auto';
    }
    if (miniProgress) miniProgress.classList.remove('visible');
    if (this.controlsTimeout) { clearTimeout(this.controlsTimeout); this.controlsTimeout = null; }
    if (this.centerPlayBtnTimeout) { clearTimeout(this.centerPlayBtnTimeout); this.centerPlayBtnTimeout = null; }
    if (this.mouseTimeout) { clearTimeout(this.mouseTimeout); this.mouseTimeout = null; }
    this.showMouse();
    this.showCenterPlayBtn();
    if (window.PLAYER) window.PLAYER.send('player-playback-changed', false);
    if (this.kamposEnhanced && this.kamposInstance) {
      (this.kamposInstance as { stop: () => void }).stop();
    }
  }

  /** 播放结束 */
  onEnded(): void {
    this.isPlaying = false;
    this.showMouse();
    // 检查自动播放下一集设置，未开启时提示用户手动操作
    if (!this.autoNext) {
      const hasNext = this.currentEpisode < this.episodes.length - 1;
      if (hasNext) {
        this.showMessage('播放已完成', '播放下一集', () => this.playNext());
      }
      return;
    }
    this.playNext();
  }

  /** 等待中 */
  onWaiting(): void {
    this.showLoading(true);
  }

  /** 可播放 */
  onCanPlay(): void {
    this.showLoading(false);
    if (this._kamposPendingEnable && !this.kamposEnhanced) {
      this._kamposPendingEnable = false;
      this.enableKampos();
    }
  }

  /** 错误 */
  onError(): void {
    this.showError('视频播放出错');
  }

  /** 更新 UI */
  updateUI(): void {
    this.updateVolumeIcon();
    this.updateEpisodeButtons();
    if (this.video) {
      this.video.volume = this.volume;
      this.video.playbackRate = this.playbackRate;
      this.updateVolumeSlider(this.volume);
    }
  }

  /** 更新剧集按钮状态 */
  private updateEpisodeButtons(): void {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) {
      if (this.currentEpisode > 0) {
        prevBtn.removeAttribute('disabled');
        prevBtn.style.opacity = '1';
        prevBtn.style.pointerEvents = 'auto';
      } else {
        prevBtn.setAttribute('disabled', 'true');
        prevBtn.style.opacity = '0.3';
        prevBtn.style.pointerEvents = 'none';
      }
    }
    if (nextBtn) {
      if (this.currentEpisode < this.episodes.length - 1) {
        nextBtn.removeAttribute('disabled');
        nextBtn.style.opacity = '1';
        nextBtn.style.pointerEvents = 'auto';
      } else {
        nextBtn.setAttribute('disabled', 'true');
        nextBtn.style.opacity = '0.3';
        nextBtn.style.pointerEvents = 'none';
      }
    }
  }

  /** 显示加载 */
  showLoading(show: boolean): void {
    const loading = document.getElementById('loadingOverlay');
    if (loading) loading.style.display = show ? 'flex' : 'none';
  }

  /** 显示错误 */
  showError(message: string): void {
    const errorOverlay = document.getElementById('errorOverlay');
    const errorText = document.getElementById('errorText');
    if (errorOverlay) errorOverlay.style.display = 'flex';
    if (errorText) errorText.textContent = message;
  }

  /** 隐藏错误 */
  hideError(): void {
    const errorOverlay = document.getElementById('errorOverlay');
    if (errorOverlay) errorOverlay.style.display = 'none';
  }

  /** 格式化时间 */
  formatTime(seconds: number): string {
    if (isNaN(seconds)) return '00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /** 最小化窗口 */
  async minimizeWindow(): Promise<void> {
    if (window.API?.player) {
      try { await window.API.player.minimize(); } catch (e) { console.warn(e); }
    }
  }

  /** 切换最大化 */
  async toggleMaximize(): Promise<void> {
    if (window.API?.player) {
      try {
        const result = await window.API.player.toggleMaximize() as { success: boolean; isMaximized: boolean };
        if (result.success) this.updateMaximizeIcon(result.isMaximized);
      } catch (e) { console.warn(e); }
    }
  }

  /** 更新最大化图标 */
  private updateMaximizeIcon(isMaximized: boolean): void {
    const icon = document.querySelector('#maximizeBtn svg');
    if (icon) {
      icon.innerHTML = isMaximized
        ? '<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="8" y="8" width="8" height="8" stroke="currentColor" stroke-width="2" fill="none"/>'
        : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/>';
    }
  }

  /** 关闭窗口 */
  async closeWindow(): Promise<void> {
    if (window.API?.player) {
      window.API.player.hide();
      await this.destroy();
    }
  }

  /** 显示上下文菜单 */
  showContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const contextMenu = document.getElementById('contextMenu');
    if (!contextMenu) return;
    const menuItems = [
      { html: `自动播放 ${this.autoplay ? '✓' : ''}`, click: () => this.toggleAutoplay() },
      { html: '画质增强', click: () => this.showEnhanceModal() },
      { html: '查看播放信息', click: () => this.showPlaybackInfoPanel() },
    ];
    contextMenu.innerHTML = '';
    menuItems.forEach((item) => {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      menuItem.textContent = item.html;
      menuItem.addEventListener('click', (ev) => { ev.stopPropagation(); item.click(); });
      contextMenu.appendChild(menuItem);
    });
    const menuWidth = 200;
    const menuHeight = menuItems.length * 40;
    const maxX = window.innerWidth - menuWidth - 10;
    const maxY = window.innerHeight - menuHeight - 10;
    contextMenu.style.left = Math.min(e.clientX, maxX) + 'px';
    contextMenu.style.top = Math.min(e.clientY, maxY) + 'px';
    contextMenu.style.display = 'block';
  }

  /** 隐藏上下文菜单 */
  hideContextMenu(): void {
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) contextMenu.style.display = 'none';
  }

  /** 切换自动播放 */
  toggleAutoplay(): void {
    this.autoplay = !this.autoplay;
    this.hideContextMenu();
    this.savePlayerSetting('autoplay', this.autoplay);
    this.showMessage(`自动播放已${this.autoplay ? '开启' : '关闭'}`);
  }

  /**
   * 格式化加速代理状态文本
   * @returns 状态描述
   */
  private formatProxyStatus(): string {
    if (!this.boostEnabled) return '已关闭';
    if (!this.proxySessionId) return '已启用（直连降级）';
    return `已启用（会话 ${this.proxySessionId.slice(0, 8)}）`;
  }

  /**
   * 异步刷新代理统计信息到视频信息弹窗
   */
  private async refreshProxyStatsIntoModal(): Promise<void> {
    const target = document.getElementById('proxyStatsValue');
    if (!target) return;
    if (!this.boostEnabled) {
      target.textContent = '未启用';
      return;
    }
    if (!this.proxySessionId || !window.API?.proxy) {
      target.textContent = '无活跃会话';
      return;
    }
    try {
      const r = await window.API.proxy.sessionInfo(this.proxySessionId);
      if (!r.ok || !r.session) {
        target.textContent = '会话已销毁';
        return;
      }
      const s = r.session;
      const stats = s.stats;
      const lines: string[] = [
        `类型: ${s.isLive ? '直播' : '点播'}`,
        `状态: ${s.state}`,
        `活跃用户: ${s.activeUsers}`,
        `请求总数: ${stats.requests}`,
        `分片成功/失败: ${stats.segOk}/${stats.segFail}`,
        `平均下载耗时: ${stats.avgDownloadMs}ms`,
        `缓存命中字节: ${this.formatBytes(stats.bytesFromCache)}`,
        `回源字节: ${this.formatBytes(stats.bytesFromOrigin)}`,
        `预取进度: ${s.prefetchProgress.loaded}/${s.prefetchProgress.total}`,
      ];
      if (s.variants.length > 0) {
        const labels = s.variants.map((v) => v.label).join(', ');
        lines.push(`码率变体: ${labels}`);
      }
      target.innerHTML = lines.join('<br>');
    } catch (e) {
      target.textContent = '统计获取失败: ' + (e as Error).message;
    }
  }

  /**
   * 格式化字节数为可读字符串
   * @param bytes 字节数
   * @returns 形如 "1.23 MB" 的字符串
   */
  private formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  /** 显示播放信息（含视频信息与加速代理统计，分组展示） */
  showPlaybackInfoPanel(): void {
    this.hideContextMenu();
    const panel = document.getElementById('playbackInfoPanel');
    const panelBody = document.getElementById('playbackInfoBody');
    if (!panel || !panelBody || !this.video) return;
    const videoInfo = {
      currentTime: this.formatTime(this.video.currentTime),
      duration: this.formatTime(this.video.duration),
      playbackRate: this.video.playbackRate + 'x',
      volume: Math.round(this.video.volume * 100) + '%',
      buffered: this.formatTime(this.video.buffered.length > 0 ? this.video.buffered.end(this.video.buffered.length - 1) : 0),
    };
    const title = this.videoData.title || this.videoData.video?.vod_name || '未知';
    const description = this.videoData.description || '暂无';
    const videoId = this.videoData.vod_id || this.videoData.id || '未知';
    panelBody.innerHTML = `
      <div class="playback-info-group-title">基本信息</div>
      <div class="playback-info-section"><div class="playback-info-label">标题</div><div class="playback-info-value">${title}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">描述</div><div class="playback-info-value">${description}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">ID</div><div class="playback-info-value playback-info-value-single">${videoId}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">剧集</div><div class="playback-info-value playback-info-value-single">${this.currentEpisode + 1} / ${this.episodes.length}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">格式</div><div class="playback-info-value playback-info-value-single">${this.currentFormat.toUpperCase()}</div></div>

      <div class="playback-info-group-title">播放状态</div>
      <div class="playback-info-section"><div class="playback-info-label">当前时间</div><div class="playback-info-value playback-info-value-single">${videoInfo.currentTime}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">总时长</div><div class="playback-info-value playback-info-value-single">${videoInfo.duration}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">播放速度</div><div class="playback-info-value playback-info-value-single">${videoInfo.playbackRate}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">音量</div><div class="playback-info-value playback-info-value-single">${videoInfo.volume}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">缓冲进度</div><div class="playback-info-value playback-info-value-single">${videoInfo.buffered}</div></div>

      <div class="playback-info-group-title">加速代理</div>
      <div class="playback-info-section"><div class="playback-info-label">状态</div><div class="playback-info-value playback-info-value-single" id="proxyStatusValue">${this.formatProxyStatus()}</div></div>
      <div class="playback-info-section"><div class="playback-info-label">统计</div><div class="playback-info-value" id="proxyStatsValue">加载中...</div></div>
    `;
    panel.style.display = 'flex';
    // 异步加载代理统计信息
    this.refreshProxyStatsIntoModal();
  }

  /** 隐藏播放信息 */
  hidePlaybackInfoPanel(): void {
    const panel = document.getElementById('playbackInfoPanel');
    if (panel) panel.style.display = 'none';
  }

  /** 历史记录相关方法 */
  async loadHistory(): Promise<void> {
    try {
      const history = await window.API?.user?.getHistory();
      if (history && Array.isArray(history)) {
        const videoId = this.videoData.vod_id || this.videoData.id || this.videoData.videoId;
        if (videoId) {
          this.historyRecord = (history as HistoryRecord[]).find((item) => item.videoId === videoId) || null;
        }
      }
    } catch {
      this.historyRecord = null;
    }
  }

  /** 获取历史记录 */
  private async getHistoryRecord(): Promise<HistoryRecord | null> {
    try {
      if (!this.videoData) return null;
      const videoId = this.videoData.vod_id || this.videoData.id || this.videoData.videoId;
      const sourceKey = this.videoData.sourceKey || 'default';
      if (window.API?.user?.getHistory) {
        const historyList = await window.API.user.getHistory();
        const record = (historyList as HistoryRecord[]).find((r) => r.videoId === videoId && r.sourceKey === sourceKey);
        return record || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 检查并恢复历史记录 */
  private async checkAndRestoreHistory(episodeIndex: number): Promise<{ isSameEpisode: boolean; isCompleted: boolean } | null> {
    try {
      // 直播流为实时播放，无有意义的历史进度可恢复，直接跳过
      if (this.videoData.type === 'live') return null;
      const record = await this.getHistoryRecord();
      if (!record) return null;
      const isSameEpisode = record.episodeIndex === episodeIndex;
      const isCompleted = record.duration > 0 && (record.progress >= record.duration * 0.9 || record.duration - record.progress < 10);
      return { isSameEpisode, isCompleted };
    } catch {
      return null;
    }
  }

  /** 处理历史记录恢复 */
  private async handleHistoryRestore(historyInfo: { isSameEpisode: boolean; isCompleted: boolean } | null): Promise<void> {
    if (!historyInfo) return;
    const currentRecord = await this.getHistoryRecord();
    if (!currentRecord) return;
    const restorePosition = () => {
      if (this.video && this.video.duration > 0) {
        if (historyInfo.isCompleted) {
          this.showMessage('该剧集已看完', '跳转下一集', () => this.playNext());
        } else {
          this.video.currentTime = currentRecord.progress;
          this.showMessage(`已恢复至 ${this.formatTime(currentRecord.progress)}`, '从头播放', () => { if (this.video) { this.video.currentTime = 0; this.video.play(); } });
        }
      } else {
        setTimeout(restorePosition, 100);
      }
    };
    restorePosition();
  }

  /** 保存进度 */
  saveProgress(): void {
    if (!this.video || !this.historyRecord) return;
    this.historyRecord.progress = this.video.currentTime;
    this.historyRecord.duration = this.video.duration;
    this.historyRecord.episodeIndex = this.currentEpisode;
    window.API?.user?.addToHistory(this.historyRecord);
  }

  /** 保存历史记录 */
  async saveHistoryRecord(): Promise<void> {
    try {
      if (!this.videoData || !this.video) return;
      const progress = this.video.currentTime;
      const duration = this.video.duration;
      const episodeIndex = this.currentEpisode;
      const format = this.currentFormat;
      let pic = this.videoData.pic || this.videoData.video?.vod_pic;
      try {
        if (!this.video.paused && this.video.readyState >= 2) {
          pic = captureVideoFrame(this.video, { width: 320, height: 180, format: 'jpeg', quality: 0.8 });
        }
      } catch { /* 忽略截图错误 */ }

      // 直播模式：以当前频道（剧集）作为历史记录主体，每个频道独立记录
      // title 取当前频道名、videoId 基于频道 URL 稳定生成，便于切台后各频道形成独立记录
      const isLive = this.videoData.type === 'live';
      const currentEpisodeObj = this.episodes[this.currentEpisode];
      const videoId = isLive && currentEpisodeObj?.url
        ? `live_${currentEpisodeObj.url}`
        : (this.videoData.vod_id || this.videoData.id || this.videoData.videoId || `unknown_${Date.now()}`);
      const title = isLive && currentEpisodeObj?.title
        ? currentEpisodeObj.title
        : (this.videoData.title || this.videoData.video?.vod_name || '未知视频');

      const historyData = {
        ...this.videoData,
        videoId,
        title,
        pic,
        progress,
        duration,
        episodeIndex,
        format,
        sourceKey: this.videoData.sourceKey,
      };
      if (window.API?.user?.addToHistory) {
        await window.API.user.addToHistory(historyData);
      }
    } catch (error) {
      console.warn('[VideoPlayer] 保存历史记录失败:', error);
    }
  }

  /** Kampos 画质增强相关方法 */
  private _loadKamposSettings(): void {
    try {
      const saved = localStorage.getItem('player_kampos');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.params) this.kamposParams = { ...this.kamposParams, ...data.params };
        if (typeof data.enabled === 'boolean') this._kamposPendingEnable = data.enabled;
      }
    } catch { /* 忽略 */ }
  }

  private _saveKamposSettings(): void {
    try {
      localStorage.setItem('player_kampos', JSON.stringify({ enabled: this.kamposEnhanced, params: this.kamposParams }));
    } catch { /* 忽略 */ }
  }

  private _updateEnhanceToggleBtn(): void {
    const toggleBtn = document.getElementById('enhanceToggleBtn');
    if (toggleBtn) {
      toggleBtn.textContent = this.kamposEnhanced ? '关闭增强' : '开启增强';
      toggleBtn.className = `enhance-btn enhance-btn-toggle ${this.kamposEnhanced ? 'active' : ''}`;
    }
  }

  private _updateDeblockTexelSize(): void {
    if (!this.kamposEffects || !this.kamposEffects.deblock || !this.video) return;
    const deblockUniforms = (this.kamposEffects.deblock as { uniforms: Array<{ name: string; data: number[] }> }).uniforms;
    const texelSizeUniform = deblockUniforms.find((u) => u.name === 'u_texelSize');
    if (texelSizeUniform && this.video.videoWidth && this.video.videoHeight) {
      texelSizeUniform.data[0] = 1.0 / this.video.videoWidth;
      texelSizeUniform.data[1] = 1.0 / this.video.videoHeight;
    }
  }

  /** 初始化 Kampos */
  initKampos(): boolean {
    if (this.kamposInstance || !window.kampos) return false;
    const video = this.video;
    const canvas = document.getElementById('kamposCanvas') as HTMLCanvasElement;
    if (!video || !canvas || video.readyState < 1) return false;
    try {
      const { Kampos, effects } = window.kampos as {
        Kampos: new (opts: { target: HTMLCanvasElement; effects: unknown[] }) => {
          setSource: (opts: { media: HTMLVideoElement; width: number; height: number }) => void;
          play: () => void;
          stop: () => void;
          destroy: () => void;
        };
        effects: {
          brightnessContrast: (opts: { brightness: number; contrast: number }) => unknown;
          hueSaturation: (opts: { saturation: number }) => unknown;
        };
      };
      if (!video.crossOrigin) video.crossOrigin = 'anonymous';
      const brightnessContrastEffect = effects.brightnessContrast({ brightness: this.kamposParams.brightness, contrast: this.kamposParams.contrast });
      const hueSaturationEffect = effects.hueSaturation({ saturation: this.kamposParams.saturation });
      const deblockEffect = adaptiveDeblock({ strength: this.kamposParams.deblock });
      this.kamposEffects = { brightnessContrast: brightnessContrastEffect, hueSaturation: hueSaturationEffect, deblock: deblockEffect };
      this.kamposInstance = new Kampos({ target: canvas, effects: [deblockEffect, brightnessContrastEffect, hueSaturationEffect] });
      (this.kamposInstance as { setSource: (opts: { media: HTMLVideoElement; width: number; height: number }) => void }).setSource({ media: video, width: video.videoWidth, height: video.videoHeight });
      this._updateDeblockTexelSize();
      (this.kamposInstance as { play: () => void }).play();
      return true;
    } catch (error) {
      console.warn('[VideoPlayer] 初始化 Kampos 失败:', error);
      this.kamposInstance = null;
      return false;
    }
  }

  /** 启用 Kampos */
  enableKampos(): void {
    if (this.currentFormat === 'iframe' || !this.video) return;
    const canvas = document.getElementById('kamposCanvas');
    if (!canvas) return;
    (canvas as HTMLElement).style.display = 'block';
    const doEnable = () => {
      const ok = this.initKampos();
      if (ok && this.kamposInstance) {
        this.video!.style.display = 'none';
        this.kamposEnhanced = true;
        this.updateKamposParams();
        this._saveKamposSettings();
        this._updateEnhanceToggleBtn();
      } else {
        (canvas as HTMLElement).style.display = 'none';
        this._updateEnhanceToggleBtn();
      }
    };
    if (this.video.readyState >= 1) requestAnimationFrame(doEnable);
    else this.video.addEventListener('loadedmetadata', () => requestAnimationFrame(doEnable), { once: true });
  }

  /** 禁用 Kampos */
  disableKampos(): void {
    if (!this.video) return;
    const canvas = document.getElementById('kamposCanvas');
    if (canvas) (canvas as HTMLElement).style.display = 'none';
    this.video.style.display = 'block';
    this.kamposEnhanced = false;
    if (this.kamposInstance) {
      try { (this.kamposInstance as { stop: () => void }).stop(); } catch { /* 忽略 */ }
    }
    this._saveKamposSettings();
    this._updateEnhanceToggleBtn();
  }

  /** 更新 Kampos 参数 */
  updateKamposParams(): void {
    if (!this.kamposEffects) return;
    const { brightnessContrast, hueSaturation, deblock } = this.kamposEffects as {
      brightnessContrast: { brightness: number; contrast: number; brightnessDisabled: boolean; contrastDisabled: boolean };
      hueSaturation: { saturation: number; saturationDisabled: boolean };
      deblock: { strength: number; disabled: boolean };
    };
    if (brightnessContrast) {
      brightnessContrast.brightness = this.kamposParams.brightness;
      brightnessContrast.contrast = this.kamposParams.contrast;
      brightnessContrast.brightnessDisabled = this.kamposParams.brightness === 1.0;
      brightnessContrast.contrastDisabled = this.kamposParams.contrast === 1.0;
    }
    if (hueSaturation) {
      hueSaturation.saturation = this.kamposParams.saturation;
      hueSaturation.saturationDisabled = this.kamposParams.saturation === 1.0;
    }
    if (deblock) {
      deblock.strength = this.kamposParams.deblock;
      deblock.disabled = this.kamposParams.deblock === 0;
    }
    if (this.video && this.kamposEnhanced && this.kamposInstance) {
      const canvas = document.getElementById('kamposCanvas');
      if (canvas) {
        (canvas as HTMLElement).style.filter = this.kamposParams.sharpness > 0
          ? `contrast(1) brightness(1) saturate(1) drop-shadow(0 0 ${this.kamposParams.sharpness}px rgba(255,255,255,0.1))`
          : '';
      }
    }
    this._saveKamposSettings();
  }

  /** 显示画质增强弹窗 */
  showEnhanceModal(): void {
    this.hideContextMenu();
    const modal = document.getElementById('enhanceModal');
    if (!modal) return;
    const sliders: Array<{ id: string; param: keyof KamposParams; valueId: string }> = [
      { id: 'enhanceBrightness', param: 'brightness', valueId: 'enhanceBrightnessValue' },
      { id: 'enhanceContrast', param: 'contrast', valueId: 'enhanceContrastValue' },
      { id: 'enhanceSaturation', param: 'saturation', valueId: 'enhanceSaturationValue' },
      { id: 'enhanceSharpness', param: 'sharpness', valueId: 'enhanceSharpnessValue' },
      { id: 'enhanceDeblock', param: 'deblock', valueId: 'enhanceDeblockValue' },
    ];
    sliders.forEach(({ id, param, valueId }) => {
      const slider = document.getElementById(id) as HTMLInputElement;
      const valueEl = document.getElementById(valueId);
      if (slider) slider.value = String(this.kamposParams[param]);
      if (valueEl) valueEl.textContent = this.kamposParams[param].toFixed(2);
    });
    this._updateEnhanceToggleBtn();
    modal.style.display = 'flex';
    this.bindEnhanceModalEvents();
  }

  /** 隐藏画质增强弹窗 */
  hideEnhanceModal(): void {
    const modal = document.getElementById('enhanceModal');
    if (modal) modal.style.display = 'none';
  }

  /** 绑定画质增强弹窗事件 */
  private bindEnhanceModalEvents(): void {
    const sliders: Array<{ id: string; param: keyof KamposParams; valueId: string }> = [
      { id: 'enhanceBrightness', param: 'brightness', valueId: 'enhanceBrightnessValue' },
      { id: 'enhanceContrast', param: 'contrast', valueId: 'enhanceContrastValue' },
      { id: 'enhanceSaturation', param: 'saturation', valueId: 'enhanceSaturationValue' },
      { id: 'enhanceSharpness', param: 'sharpness', valueId: 'enhanceSharpnessValue' },
      { id: 'enhanceDeblock', param: 'deblock', valueId: 'enhanceDeblockValue' },
    ];
    sliders.forEach(({ id, param, valueId }) => {
      const slider = document.getElementById(id) as HTMLInputElement;
      const valueEl = document.getElementById(valueId);
      if (!slider) return;
      slider.oninput = () => {
        const val = parseFloat(slider.value);
        this.kamposParams[param] = val;
        if (valueEl) valueEl.textContent = val.toFixed(2);
        if (this.kamposEnhanced) this.updateKamposParams();
      };
    });
    const resetBtn = document.getElementById('enhanceResetBtn');
    if (resetBtn) {
      resetBtn.onclick = () => {
        this.kamposParams = { brightness: 1.0, contrast: 1.0, saturation: 1.0, sharpness: 0.0, deblock: 0.0 };
        this.showEnhanceModal();
        if (this.kamposEnhanced) this.updateKamposParams();
      };
    }
    const toggleBtn = document.getElementById('enhanceToggleBtn');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        if (this.kamposEnhanced) this.disableKampos();
        else this.enableKampos();
      };
    }
    const modal = document.getElementById('enhanceModal');
    if (modal) {
      modal.onclick = (e) => { if ((e.target as HTMLElement) === modal) this.hideEnhanceModal(); };
    }
  }

  /** 销毁 Kampos */
  destroyKampos(): void {
    if (this.kamposInstance) {
      try { (this.kamposInstance as { destroy: () => void }).destroy(); } catch { /* 忽略 */ }
      this.kamposInstance = null;
    }
    this.kamposEffects = null;
    this.kamposEnhanced = false;
    const canvas = document.getElementById('kamposCanvas');
    if (canvas) (canvas as HTMLElement).style.display = 'none';
    if (this.video) this.video.style.display = 'block';
  }

  /** 销毁播放器 */
  async destroy(): Promise<void> {
    this.isDestroying = true;
    this.destroyKampos();

    // 主动销毁加速代理会话，释放内存与磁盘缓存
    await this.destroyProxySession();

    // 移除窗口尺寸监听
    window.removeEventListener('resize', this.handleResize);
    if (this.resizeTimer) { clearTimeout(this.resizeTimer); this.resizeTimer = null; }

    // 通过 AbortController 一次性移除所有 document 级事件监听
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }

    const timers = [this.controlsTimeout, this.centerPlayBtnTimeout, this.messageTimeout, this.mouseTimeout, this.volumeSaveTimer, this.historySaveTimer, this.settingsHideTimer];
    timers.forEach((timer) => { if (timer) clearTimeout(timer); });
    this.controlsTimeout = null;
    this.centerPlayBtnTimeout = null;
    this.messageTimeout = null;
    this.mouseTimeout = null;
    this.volumeSaveTimer = null;
    this.historySaveTimer = null;
    this.settingsHideTimer = null;

    const iframePlayer = document.getElementById('iframePlayer') as HTMLIFrameElement;
    if (iframePlayer) {
      try {
        iframePlayer.src = 'about:blank';
        iframePlayer.onload = null;
        iframePlayer.onerror = null;
      } catch { /* 忽略 */ }
    }

    if (this.hls) {
      try { (this.hls as { destroy: () => void }).destroy(); } catch { /* 忽略 */ }
      this.hls = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.removeAttribute('src');
      while (this.video.firstChild) this.video.removeChild(this.video.firstChild);
      this.video.load();
      this.video.currentTime = 0;
      this.video.volume = 1;
      this.video.playbackRate = 1;
      const videoClone = this.video.cloneNode(false) as HTMLVideoElement;
      this.video.parentNode?.replaceChild(videoClone, this.video);
    }

    try { await this.saveHistoryRecord(); } catch { /* 忽略 */ }

    const playerContainer = document.getElementById('playerContainer');
    if (playerContainer) {
      playerContainer.innerHTML = '';
      playerContainer.classList.remove('show');
    }

    this.isDestroying = false;
    this.video = null;
    this.currentEpisode = 0;
    this.episodes = [];
    this.isPlaying = false;
    this.isFullscreen = false;
    this.isImmersiveMode = false;
    this.currentRotation = 0;
    this.historyRecord = null;
    this.lastHistorySaveTime = 0;
    document.body.style.cursor = 'auto';
  }
}
