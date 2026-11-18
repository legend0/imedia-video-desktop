/**
 * @file FFmpeg 桥接层：使用项目内置 ffmpeg.exe，流复制（-c copy）合并点播流
 *
 * 复用项目 e/main/downloaders/ffmpeg.js 的 getFfmpegPath() 解析路径，
 * 避免重复打包 ffmpeg.exe，确保路径解析与下载模块一致。
 *
 * 当 FFmpeg 不可用时，模块自动降级为空操作，不影响主流程。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { createLogger } = require('./utils');
const { diskCache } = require('./cache');

const log = createLogger('ffmpeg');

/** FFmpeg 是否可用（启动时探测一次） */
let ffmpegAvailable = false;

/** 缓存的项目 ffmpeg 模块（懒加载） */
let projectFfmpegModule = null;

/**
 * 懒加载项目 ffmpeg 模块，避免启动时的循环依赖
 * @returns {{getFfmpegPath:()=>string, checkFfmpeg:()=>boolean}|null}
 */
function loadProjectFfmpeg() {
    if (projectFfmpegModule !== null) return projectFfmpegModule;
    try {
        // 项目下载器模块，提供 getFfmpegPath() 和 checkFfmpeg()
        projectFfmpegModule = require('../../downloaders/ffmpeg');
        return projectFfmpegModule;
    } catch (e) {
        log.warn('无法加载项目 ffmpeg 模块:', e.message);
        projectFfmpegModule = null;
        return null;
    }
}

/**
 * 获取 FFmpeg 可执行文件路径（委托给项目模块，确保路径一致）
 * @returns {string}
 */
function getFfmpegPath() {
    const mod = loadProjectFfmpeg();
    if (mod && typeof mod.getFfmpegPath === 'function') {
        return mod.getFfmpegPath();
    }
    return '';
}

/**
 * 探测 ffmpeg 是否可用
 * @returns {Promise<boolean>}
 */
async function probeFfmpeg() {
    const mod = loadProjectFfmpeg();
    if (mod && typeof mod.checkFfmpeg === 'function') {
        ffmpegAvailable = mod.checkFfmpeg();
        if (ffmpegAvailable) {
            log.info('FFmpeg 可用（通过项目模块检测）');
        } else {
            log.warn('FFmpeg 不可用，合并功能将降级关闭');
        }
        return ffmpegAvailable;
    }
    // 兜底：直接 spawn 探测
    const binaryPath = getFfmpegPath();
    if (!binaryPath) {
        ffmpegAvailable = false;
        return false;
    }
    return new Promise((resolve) => {
        try {
            const p = spawn(binaryPath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            p.stdout.on('data', (c) => (out += c.toString()));
            p.on('error', () => resolve(false));
            p.on('close', (code) => {
                ffmpegAvailable = code === 0 && /ffmpeg version/i.test(out);
                if (ffmpegAvailable) {
                    log.info('FFmpeg 可用:', out.split('\n')[0]);
                } else {
                    log.warn('FFmpeg 不可用，合并功能将降级关闭');
                }
                resolve(ffmpegAvailable);
            });
        } catch {
            ffmpegAvailable = false;
            resolve(false);
        }
    });
}

/**
 * 后台启动 FFmpeg 合并任务（流复制，输出单文件到磁盘缓存）
 * 不阻塞主流程，失败仅记日志。
 * @param {import('./session').Session} session
 * @returns {{promise:Promise<void>, stop:()=>void}|null}
 */
function tryFfmpegMerge(session) {
    if (!ffmpegAvailable) {
        log.debug(`[${session.id}] FFmpeg 不可用，跳过合并`);
        return null;
    }
    const cfg = session.config.ffmpeg;
    const outDir = diskCache.sessionDir(session.id);
    const outFile = path.join(outDir, 'merged.mp4');

    const binaryPath = getFfmpegPath();
    const args = [
        '-hide_banner', '-loglevel', 'error',
        '-i', session.sourceUrl,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outFile,
    ];

    log.info(`[${session.id}] 启动 FFmpeg 合并 -> ${path.basename(outFile)}`);
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    /** @type {string} */ let errBuf = '';
    child.stderr.on('data', (c) => { errBuf += c.toString(); });

    const promise = new Promise((resolve) => {
        child.on('close', (code) => {
            if (code === 0) {
                log.info(`[${session.id}] FFmpeg 合并完成: merged.mp4`);
            } else {
                log.warn(`[${session.id}] FFmpeg 合并退出码 ${code}:`, errBuf.slice(0, 300));
            }
            resolve();
        });
        child.on('error', (e) => {
            log.warn(`[${session.id}] FFmpeg 启动失败:`, e.message);
            resolve();
        });
    });

    return {
        promise,
        stop: () => {
            try { child.kill('SIGTERM'); } catch { /* noop */ }
        },
    };
}

/**
 * 异步初始化：探测 ffmpeg
 * @param {object} cfg
 */
async function initFfmpeg(cfg) {
    if (cfg.ffmpeg.enabled === 'off') {
        ffmpegAvailable = false;
        log.info('FFmpeg 已被配置为关闭 (enabled=off)');
        return;
    }
    await probeFfmpeg();
}

module.exports = {
    get ffmpegAvailable() { return ffmpegAvailable; },
    probeFfmpeg,
    tryFfmpegMerge,
    initFfmpeg,
    getFfmpegPath,
};
