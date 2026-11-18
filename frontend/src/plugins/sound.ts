/**
 * 音效池插件
 * 提供下载完成、收藏等场景的特效音功能
 * 注意：短期内不能多次触发（冷却机制），不能多个同时触发（后一个覆盖前一个）
 */

/** 单个音效的配置选项 */
export interface SoundOptions {
  /** 该音效的独立冷却时间（毫秒），不传则使用全局冷却 */
  cooldown?: number;
  /** 该音效的独立音量（0-1），不传则使用全局音量 */
  volume?: number;
}

/** 音效池构造选项 */
export interface SoundPoolOptions {
  /** 全局冷却时间（毫秒），默认 1000 */
  cooldown?: number;
  /** 全局默认音量（0-1），默认 0.5 */
  volume?: number;
}

/** 批量注册的音效映射值：字符串路径或带配置的对象 */
export type SoundMapValue = string | (SoundOptions & { src: string });

/** 音效池内部条目结构 */
interface SoundEntry {
  src: string;
  cooldown?: number;
  volume?: number;
}

/**
 * 音效池类
 * 管理多个音效的注册、播放、冷却与生命周期
 */
export class SoundPool {
  private _pool: Map<string, SoundEntry>;
  private _currentAudio: HTMLAudioElement | null;
  private _currentKey: string | null;
  private _cooldownTimers: Map<string, boolean>;
  private _cooldown: number;
  private _enabled: boolean;
  private _volume: number;

  /**
   * 创建音效池实例
   * @param options - 全局配置选项
   * @param {number} [options.cooldown=1000] - 全局冷却时间（毫秒）
   * @param {number} [options.volume=0.5] - 全局默认音量（0-1）
   */
  constructor(options: SoundPoolOptions = {}) {
    this._pool = new Map();
    this._currentAudio = null;
    this._currentKey = null;
    this._cooldownTimers = new Map();
    this._cooldown = options.cooldown ?? 1000;
    this._enabled = true;
    this._volume = options.volume ?? 0.5;
  }

  /**
   * 注册单个音效到音效池
   * @param key - 音效唯一标识
   * @param src - 音效文件路径
   * @param opts - 该音效的独立配置（冷却时间/音量）
   */
  register(key: string, src: string, opts: SoundOptions = {}): void {
    this._pool.set(key, {
      src,
      cooldown: opts.cooldown,
      volume: opts.volume,
    });
  }

  /**
   * 批量注册音效
   * @param map - 音效映射，值为字符串路径或 { src, cooldown, volume } 对象
   */
  registerAll(map: Record<string, SoundMapValue>): void {
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'string') {
        this.register(key, value);
      } else {
        this.register(key, value.src, value);
      }
    }
  }

  /**
   * 播放指定音效
   * @param key - 音效标识
   * @returns 是否成功触发播放（未注册或冷却中返回 false）
   */
  play(key: string): boolean {
    if (!this._enabled) return false;

    const sound = this._pool.get(key);
    if (!sound) {
      console.warn(`SoundPool: 未注册的音效 "${key}"`);
      return false;
    }

    if (this._cooldownTimers.has(key)) {
      return false;
    }

    // 后一个覆盖前一个：停止当前播放
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio.currentTime = 0;
      this._currentAudio = null;
      this._currentKey = null;
    }

    const audio = new Audio(sound.src);
    audio.volume = sound.volume ?? this._volume;

    this._currentAudio = audio;
    this._currentKey = key;

    // 设置冷却定时器
    const cooldown = sound.cooldown ?? this._cooldown;
    this._cooldownTimers.set(key, true);
    window.setTimeout(() => {
      this._cooldownTimers.delete(key);
    }, cooldown);

    audio.play().catch(() => {});

    audio.addEventListener('ended', () => {
      if (this._currentAudio === audio) {
        this._currentAudio = null;
        this._currentKey = null;
      }
    });

    audio.addEventListener('error', () => {
      if (this._currentAudio === audio) {
        this._currentAudio = null;
        this._currentKey = null;
      }
    });

    return true;
  }

  /**
   * 停止当前正在播放的音效
   */
  stop(): void {
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio.currentTime = 0;
      this._currentAudio = null;
      this._currentKey = null;
    }
  }

  /**
   * 设置全局音量
   * @param vol - 音量值（0-1），会自动钳制到合法范围
   */
  setVolume(vol: number): void {
    this._volume = Math.max(0, Math.min(1, vol));
    if (this._currentAudio) {
      this._currentAudio.volume = this._volume;
    }
  }

  /**
   * 获取当前全局音量
   * @returns 音量值（0-1）
   */
  getVolume(): number {
    return this._volume;
  }

  /**
   * 启用或禁用音效系统
   * @param enabled - true 启用，false 禁用并停止当前播放
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  /**
   * 获取音效系统启用状态
   * @returns 当前是否启用
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * 检查指定音效是否处于冷却中
   * @param key - 音效标识
   * @returns 是否在冷却中
   */
  isCoolingDown(key: string): boolean {
    return this._cooldownTimers.has(key);
  }

  /**
   * 检查音效是否已注册
   * @param key - 音效标识
   * @returns 是否已注册
   */
  has(key: string): boolean {
    return this._pool.has(key);
  }

  /**
   * 移除指定音效（若正在播放则先停止）
   * @param key - 音效标识
   */
  remove(key: string): void {
    if (this._currentKey === key) {
      this.stop();
    }
    this._pool.delete(key);
    this._cooldownTimers.delete(key);
  }

  /**
   * 销毁音效池，释放所有资源
   */
  destroy(): void {
    this.stop();
    this._pool.clear();
    this._cooldownTimers.clear();
  }
}

/** 默认音效配置（对应旧版 demo/js/app.js 的 sounds 配置） */
export const DEFAULT_SOUNDS: Record<string, SoundMapValue> = {
  'download:complete': './audio/complete.mp3',
  'download:failed': { src: './audio/failed.mp3', cooldown: 2000 },
  notify: './audio/notify.mp3',
  favorite: './audio/favorite.mp3',
  error: './audio/error.mp3',
};
