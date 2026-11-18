/**
 * @file M3U8 加速代理入口
 *
 * 通过 IPC + 本地 HTTP 混合方案集成到 Electron 主进程：
 * - 控制面（创建/销毁/统计）走 IPC，由 main.js 注册的 ipcMain.handle 调用本模块
 * - 数据面（m3u8/ts 流）走 127.0.0.1 本地 HTTP 服务，由 hls.js 直接加载
 *
 * 暴露的接口：
 *   initProxy()                初始化（需在 app ready 后调用）
 *   boost(url, opts)           创建加速会话，返回本地播放 URL
 *   expireSession(id)          销毁会话
 *   getSessionInfo(id)         获取会话实时状态
 *   listSessions()             会话列表
 *   getStats()                 全局统计
 *   shutdownProxy()            关闭服务并清理资源
 */

const { initConfig, getConfig } = require('./lib/config');
const { initCache } = require('./lib/cache');
const { initFfmpeg } = require('./lib/ffmpeg');
const { startServer, globalStats } = require('./lib/server');
const {
    createSession,
    getSession,
    listSessions,
    expireSession,
    startCleanup,
    cleanup,
} = require('./lib/session');
const { createLogger } = require('./lib/utils');

const log = createLogger('index');

/** @type {import('node:http').Server|null} */
let httpServer = null;
/** 是否已初始化完成 */
let initialized = false;
/** 是否正在初始化 */
let initializing = false;

/**
 * 初始化代理模块（需在 app ready 后调用）
 * 幂等：多次调用安全
 * @returns {Promise<{ ok: boolean, baseUrl?: string, error?: string }>}
 */
async function initProxy() {
    if (initialized) {
        return { ok: true, baseUrl: getBaseUrl() };
    }
    if (initializing) {
        // 等待正在进行的初始化完成
        while (initializing) {
            await new Promise((r) => setTimeout(r, 50));
        }
        return { ok: initialized, baseUrl: initialized ? getBaseUrl() : undefined };
    }
    initializing = true;

    try {
        // 1. 初始化配置（填充缓存目录绝对路径）
        const cfg = initConfig();
        log.info(`缓存目录: ${cfg.cache.disk.absPath}`);

        // 2. 初始化缓存（内存 LRU + 磁盘会话目录）
        await initCache();

        // 3. 探测 FFmpeg（auto 模式下失败不影响主流程）
        await initFfmpeg(cfg);

        // 4. 启动本地 HTTP 服务（127.0.0.1）
        httpServer = await startServer();

        // 5. 启动会话 TTL 定时清理
        startCleanup();

        initialized = true;
        log.info('代理模块初始化完成');
        return { ok: true, baseUrl: getBaseUrl() };
    } catch (e) {
        log.error('代理模块初始化失败:', e.message);
        // 初始化失败时不应阻塞应用启动，降级为直连模式
        initialized = false;
        return { ok: false, error: e.message };
    } finally {
        initializing = false;
    }
}

/**
 * 获取本地 HTTP 服务 baseUrl
 * @returns {string}
 */
function getBaseUrl() {
    const cfg = getConfig();
    return `http://${cfg.server.host}:${cfg.server.port}`;
}

/**
 * 创建加速会话
 * @param {string} sourceUrl 原始 m3u8/mp4 播放地址
 * @param {{ mode?: 'auto'|'live'|'vod', cacheTtl?: number }} [opts]
 * @returns {Promise<{ ok: boolean, sessionId?: string, playUrl?: string, baseUrl?: string, meta?: object, error?: string }>}
 */
async function boost(sourceUrl, opts = {}) {
    if (!initialized) {
        // 懒初始化：首次调用时若未就绪，尝试初始化
        const r = await initProxy();
        if (!r.ok) {
            return { ok: false, error: r.error || 'proxy not initialized' };
        }
    }
    if (!sourceUrl || typeof sourceUrl !== 'string') {
        return { ok: false, error: 'invalid sourceUrl' };
    }
    try {
        const mode = ['auto', 'live', 'vod'].includes(opts.mode) ? opts.mode : 'auto';
        const cacheTtl = Number(opts.cacheTtl) || 0;

        // 会话复用：同源且未过期
        const existing = listSessions().find((s) => s.sourceUrl === sourceUrl && s.state !== 'expired');
        const session = existing || createSession(sourceUrl, mode, cacheTtl);

        // 构造 hls.js 可直接加载的绝对 URL
        const baseUrl = getBaseUrl();
        const playUrl = `${baseUrl}/stream/${session.id}/master.m3u8`;

        return {
            ok: true,
            sessionId: session.id,
            playUrl,
            baseUrl,
            meta: {
                type: session.isLive ? 'live' : 'vod',
                duration: session._maxDuration ? session._maxDuration() : 0,
                bitrates: (session.master?.variants || []).map((v) => v.bandwidth),
                ready: session.state === 'ready',
                state: session.state,
            },
        };
    } catch (e) {
        log.error('创建加速会话失败:', e.message);
        return { ok: false, error: e.message };
    }
}

/**
 * 销毁指定会话
 * @param {string} sessionId
 * @returns {Promise<{ ok: boolean, expired?: boolean, error?: string }>}
 */
async function expireSessionSafe(sessionId) {
    try {
        const expired = await expireSession(sessionId);
        return { ok: true, expired };
    } catch (e) {
        log.error('销毁会话失败:', e.message);
        return { ok: false, error: e.message };
    }
}

/**
 * 获取某会话实时状态（用于播放器视频信息统计）
 * @param {string} sessionId
 * @returns {{ ok: boolean, session?: object, error?: string }}
 */
function getSessionInfo(sessionId) {
    try {
        const s = getSession(sessionId);
        if (!s) return { ok: false, error: 'session not found' };
        return { ok: true, session: s.toJSON() };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * 列出所有活跃会话
 * @returns {{ ok: boolean, sessions?: object[] }}
 */
function listSessionsSafe() {
    try {
        return { ok: true, sessions: listSessions().map((s) => s.toJSON()) };
    } catch (e) {
        return { ok: false, sessions: [], error: e.message };
    }
}

/**
 * 全局统计（内存/磁盘/缓存命中率/请求计数）
 * @returns {{ ok: boolean, stats?: object }}
 */
function getStats() {
    try {
        return { ok: true, stats: globalStats() };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * 手动触发一轮清理（通常不需要，TTL 自动执行）
 * @returns {Promise<{ ok: boolean }>}
 */
async function runCleanup() {
    try {
        await cleanup();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * 关闭代理服务并清理所有会话缓存（应用退出时调用）
 * @returns {Promise<void>}
 */
async function shutdownProxy() {
    log.info('开始关闭代理模块...');
    // 销毁所有活跃会话（含磁盘缓存清理）
    const sessions = listSessions();
    await Promise.all(sessions.map((s) => s.destroy().catch(() => {})));

    // 关闭 HTTP 服务
    if (httpServer) {
        await new Promise((resolve) => {
            httpServer.close(() => resolve());
            // 兜底：2 秒后强制结束
            setTimeout(resolve, 2000);
        });
        httpServer = null;
    }

    initialized = false;
    log.info('代理模块已关闭');
}

module.exports = {
    initProxy,
    boost,
    expireSession: expireSessionSafe,
    getSessionInfo,
    listSessions: listSessionsSafe,
    getStats,
    runCleanup,
    shutdownProxy,
    // 暴露内部清理函数便于单元测试与诊断
    _internal: { createSession, getSession, cleanup },
};
