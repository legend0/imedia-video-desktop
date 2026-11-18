/**
 * @file 配置模块：嵌入默认配置，缓存目录指向项目 storage/cache/proxy/
 *
 * 集成到主进程后不再需要配置文件热更新，关键参数通过代码调整。
 */

const path = require('node:path');
const { app } = require('electron');
const { parseBytes } = require('./utils');

/**
 * 获取存储根目录（延迟至 app ready 后调用）
 * @returns {string}
 */
function getStorageDir() {
    const isPackaged = app.isPackaged
        || (!process.execPath.includes('node_modules\\electron')
            && !process.execPath.includes('node_modules/electron'));
    const appRoot = isPackaged
        ? path.dirname(app.getPath('exe'))
        : process.cwd();
    return path.join(appRoot, 'storage');
}

/**
 * 获取代理磁盘缓存目录
 * @returns {string}
 */
function getProxyCacheDir() {
    return path.join(getStorageDir(), 'cache', 'proxy');
}

/** 默认配置 */
const DEFAULTS = {
    server: {
        host: '127.0.0.1',  // 仅绑定本地，安全考虑
        port: 7788,
        cors: true,
    },
    cache: {
        memory: {
            maxSize: '200MB',  // 桌面应用适当降低
            maxBytes: parseBytes('200MB'),
        },
        disk: {
            maxSize: '2GB',   // 桌面应用适当降低
            maxBytes: parseBytes('2GB'),
            path: './cache/proxy',
            absPath: '',  // 运行时填充
        },
    },
    prefetch: {
        initialSegments: 5,
        maxConcurrent: 6,
        adaptive: true,
        liveRefreshIntervalRatio: 0.5,
    },
    ffmpeg: {
        enabled: 'auto',  // auto | on | off
        autoMerge: false,  // 桌面播放场景默认关闭合并，按需切片缓存即可
        minDurationForMerge: 30,
        outputSegmentDuration: 6,
    },
    session: {
        // TTL 仅作统计展示用，不再用于自动销毁（避免播放器暂停时被误清理）
        // 会话销毁由调用方主动触发（播放器关闭/切换剧集）
        vodTtl: 300,
        liveTtl: 30,
        cleanupInterval: 60,  // 清理检查间隔（秒），仅清理已 expired 的会话
    },
};

/** 当前生效配置 */
let currentConfig = null;

/**
 * 初始化配置（需在 app ready 后调用）
 * @returns {object}
 */
function initConfig() {
    const cfg = JSON.parse(JSON.stringify(DEFAULTS));
    cfg.cache.disk.absPath = getProxyCacheDir();
    currentConfig = cfg;
    return cfg;
}

/**
 * 获取当前生效配置
 * @returns {object}
 */
function getConfig() {
    if (!currentConfig) {
        return initConfig();
    }
    return currentConfig;
}

module.exports = {
    initConfig,
    getConfig,
    getProxyCacheDir,
    DEFAULTS,
};
