/**
 * @file 会话管理器：管理每个流的完整生命周期
 */

const path = require('node:path');
const { createLogger, generateSessionId, shortHash, toIso } = require('./utils');
const { getConfig } = require('./config');
const { setCache, getCache, clearSessionCache, buildCacheKey, diskCache, memoryCache } = require('./cache');
const { rewriteMaster, rewriteMedia, segmentExt } = require('./m3u8');
const { PrefetchEngine } = require('./prefetch');
const { tryFfmpegMerge, ffmpegAvailable } = require('./ffmpeg');

const log = createLogger('session');

/**
 * @typedef {'preparing'|'ready'|'expired'} SessionState
 */

/**
 * 单个加速会话
 */
class Session {
    /**
     * @param {string} sourceUrl 原始播放地址
     * @param {'auto'|'live'|'vod'} mode 模式
     * @param {number} [cacheTtl] 缓存有效期（秒）
     */
    constructor(sourceUrl, mode, cacheTtl) {
        this.id = generateSessionId();
        this.sourceUrl = sourceUrl;
        this.sourceHash = shortHash(sourceUrl);
        this.mode = mode || 'auto';

        this.createdAt = Date.now();
        this.lastAccessAt = this.createdAt;
        this.expiresAt = 0;
        /** @type {SessionState} */ this.state = 'preparing';

        /** @type {string} */ this.masterText = '';
        /** @type {object|null} */ this.master = null;
        /** @type {string} */ this.finalUrl = sourceUrl;
        this.isLive = false;

        /** @type {Map<string, {text:string, parsed:object, url:string}>} */
        this.playlists = new Map();
        /** @type {Map<string, Map<string,string>>} label -> (代理路径 -> 原始 key URL) */
        this.keyMaps = new Map();

        /** @type {Set<string>} */ this.cacheKeys = new Set();
        this.prefetchProgress = { loaded: 0, total: 0 };

        this.activeUsers = 0;
        this.cacheTtl = cacheTtl || 0;

        /** 统计：分片下载耗时与成败 */
        this.stats = {
            segDownloadMs: [],
            segOk: 0,
            segFail: 0,
            bytesServed: 0,
            bytesFromCache: 0,
            bytesFromOrigin: 0,
            requests: 0,
        };

        this.config = getConfig();
        this._prefetch = null;
        this._ffmpegTask = null;
    }

    /** 更新访问时间 */
    touch() { this.lastAccessAt = Date.now(); }

    /**
     * 异步初始化：解析 + 预取（不阻塞调用方）
     * @returns {void}
     */
    prepare() {
        this._prefetch = new PrefetchEngine(this);
        this._prefetch.start().then(() => {
            if (this.isLive) this._prefetch.startLiveRefresh();
            this._maybeStartFfmpeg();
        }).catch((e) => log.error(`[${this.id}] prepare 异常:`, e.message));
    }

    /** 视情况启动 FFmpeg 合并 */
    async _maybeStartFfmpeg() {
        const cfg = this.config.ffmpeg;
        if (!cfg.autoMerge) return;
        if (cfg.enabled === 'off') return;
        if (cfg.enabled === 'auto' && !ffmpegAvailable) return;
        if (this.isLive) return;
        const maxDur = this._maxDuration();
        if (maxDur < (cfg.minDurationForMerge || 30)) return;
        try {
            this._ffmpegTask = tryFfmpegMerge(this);
        } catch (e) {
            log.warn(`[${this.id}] FFmpeg 合并启动失败:`, e.message);
        }
    }

    /**
     * 返回所有 playlist 中的最大时长
     * @returns {number}
     */
    _maxDuration() {
        let m = 0;
        for (const entry of this.playlists.values()) {
            if (entry.parsed.totalDuration > m) m = entry.parsed.totalDuration;
        }
        return m;
    }

    /**
     * 存储子 playlist
     * @param {string} label
     * @param {{text:string, parsed:object, url:string}} entry
     */
    setPlaylist(label, entry) { this.playlists.set(label, entry); }

    /**
     * 获取子 playlist
     * @param {string} label
     * @returns {object|null}
     */
    getPlaylist(label) { return this.playlists.get(label) || null; }

    /**
     * 生成某分片在磁盘缓存的绝对路径
     * @param {string} label
     * @param {string} fileName
     * @returns {string}
     */
    segmentDiskPath(label, fileName) {
        return path.join(diskCache.sessionDir(this.id), label, fileName);
    }

    /**
     * 是否已缓存该分片（内存）
     * @param {string} key
     * @returns {boolean}
     */
    hasSegment(key) {
        return memoryCache.has(key) || false;
    }

    /**
     * 写入分片缓存
     * @param {string} key
     * @param {Buffer} buffer
     * @param {string} diskPath
     */
    async cacheSegment(key, buffer, diskPath) {
        this.cacheKeys.add(key);
        await setCache(key, buffer, diskPath);
    }

    /**
     * 标记会话状态
     * @param {SessionState} state
     */
    markState(state) { this.state = state; }

    /**
     * 记录预取进度
     * @param {number} loaded
     * @param {number} total
     * @param {string} [label]
     */
    recordPrefetch(loaded, total, label) {
        this.prefetchProgress = { loaded, total, label: label || this.prefetchProgress.label };
    }

    /**
     * 记录分片下载统计
     * @param {number} deltaMs
     * @param {boolean} ok
     */
    recordStats(deltaMs, ok) {
        if (ok) this.stats.segOk++; else this.stats.segFail++;
        this.stats.segDownloadMs.push(deltaMs);
        if (this.stats.segDownloadMs.length > 100) this.stats.segDownloadMs.shift();
    }

    /**
     * 返回重写后的 master playlist
     * @returns {string}
     */
    getRewrittenMaster() {
        if (!this.masterText) return '';
        return rewriteMaster(this.masterText, this.id, this.finalUrl);
    }

    /**
     * 返回某码率的重写子 playlist（同时收集密钥代理映射）
     * @param {string} label
     * @returns {string|null}
     */
    getRewrittenMedia(label) {
        const entry = this.getPlaylist(label);
        if (!entry) return null;
        const keyMap = new Map();
        const text = rewriteMedia(entry.text, this.id, entry.url, label, { keyMap });
        if (keyMap.size) this.keyMaps.set(label, keyMap);
        return text;
    }

    /**
     * 根据代理路径查询密钥原始 URL
     * @param {string} label
     * @param {string} proxyPath 形如 /stream/{sid}/{label}/key_0.key
     * @returns {string|null}
     */
    getKeyOriginUrl(label, proxyPath) {
        const m = this.keyMaps.get(label);
        return m ? (m.get(proxyPath) || null) : null;
    }

    /**
     * 读取已缓存的分片
     * @param {string} label
     * @param {number} index
     * @returns {Promise<Buffer|null>}
     */
    async getSegment(label, index) {
        const key = buildCacheKey(this.sourceHash, 'ts', `${label}:${index}`);
        const entry = this.getPlaylist(label);
        const seg = entry?.parsed.segments[index];
        const fileName = seg ? `segment_${index}${segmentExt(seg.url)}` : `segment_${index}.ts`;
        const diskPath = this.segmentDiskPath(label, fileName);
        const data = await getCache(key, diskPath, 'ts');
        if (data) this.stats.bytesFromCache += data.length;
        return data;
    }

    /** 销毁会话 */
    async destroy() {
        this.state = 'expired';
        this.expiresAt = Date.now();
        if (this._prefetch) this._prefetch.stop();
        await clearSessionCache(this.id);
        log.info(`[${this.id}] 会话已销毁`);
    }

    /**
     * 状态快照（JSON 安全）
     * @returns {object}
     */
    toJSON() {
        return {
            sessionId: this.id,
            sourceUrl: this.sourceUrl,
            mode: this.mode,
            state: this.state,
            isLive: this.isLive,
            type: this.isLive ? 'live' : 'vod',
            createdAt: toIso(this.createdAt),
            lastAccessAt: toIso(this.lastAccessAt),
            activeUsers: this.activeUsers,
            prefetchProgress: this.prefetchProgress,
            variants: (this.master?.variants || []).map((v) => ({
                label: v.label,
                bandwidth: v.bandwidth,
                resolution: v.resolution,
            })),
            duration: this._maxDuration(),
            stats: {
                ...this.stats,
                avgDownloadMs: this.stats.segDownloadMs.length
                    ? Math.round(this.stats.segDownloadMs.reduce((a, b) => a + b, 0) / this.stats.segDownloadMs.length)
                    : 0,
            },
        };
    }
}

/** 全局会话表 */
const sessions = new Map();

/**
 * 创建加速会话
 * @param {string} sourceUrl
 * @param {'auto'|'live'|'vod'} mode
 * @param {number} [cacheTtl]
 * @returns {Session}
 */
function createSession(sourceUrl, mode, cacheTtl) {
    const s = new Session(sourceUrl, mode, cacheTtl);
    sessions.set(s.id, s);
    log.info(`[${s.id}] 创建会话: ${sourceUrl}`);
    s.prepare();
    return s;
}

/**
 * 获取会话
 * @param {string} id
 * @returns {Session|undefined}
 */
function getSession(id) { return sessions.get(id); }

/**
 * 列出所有会话
 * @returns {Session[]}
 */
function listSessions() { return Array.from(sessions.values()); }

/**
 * 销毁会话
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function expireSession(id) {
    const s = sessions.get(id);
    if (!s) return false;
    await s.destroy();
    sessions.delete(id);
    return true;
}

/**
 * 启动定时清理过期会话（unref，不阻塞进程退出）
 */
function startCleanup() {
    const cfg = getConfig();
    const interval = (cfg.session.cleanupInterval || 60) * 1000;
    setInterval(() => cleanup().catch((e) => log.warn('清理异常:', e.message)), interval).unref();
    log.info(`定时清理已启动，间隔 ${interval}ms`);
}

/**
 * 执行一轮清理：仅清理已被标记为 expired 的会话
 *
 * 注意：不再基于空闲时间自动销毁会话，避免播放器暂停时被误清理导致无法继续播放。
 * 会话销毁由调用方主动调用 expireSession 触发（如播放器关闭、切换剧集）。
 * 应用退出时 shutdownProxy 会兜底销毁所有会话。
 */
async function cleanup() {
    /** @type {Promise[]} */ const jobs = [];
    for (const s of sessions.values()) {
        if (s.state !== 'expired') continue;
        jobs.push((async () => {
            await s.destroy().catch(() => {});
            sessions.delete(s.id);
        })());
    }
    await Promise.all(jobs);
}

module.exports = {
    Session,
    createSession,
    getSession,
    listSessions,
    expireSession,
    startCleanup,
    cleanup,
};
