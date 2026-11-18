/**
 * @file HTTP 服务器与路由层
 *
 * 仅保留核心流代理服务，绑定到 127.0.0.1：
 *   POST /api/boost                         创建加速会话
 *   GET  /api/boost/sessions                活跃会话列表
 *   GET  /api/boost/sessions/:id            某会话实时状态
 *   POST /api/boost/sessions/:id/expire     手动销毁会话
 *   GET  /api/boost/stats                   全局统计
 *   POST /api/boost/sessions/:id/heartbeat  播放器缓冲上报
 *   GET  /stream/:sessionId/master.m3u8     重写后的主播放列表
 *   GET  /stream/:sessionId/:label/index.m3u8  重写后的子播放列表
 *   GET  /stream/:sessionId/:label/segment_N.ts  分片
 *   GET  /stream/:sessionId/:label/init.mp4   fMP4 初始化段
 *   GET  /stream/:sessionId/:label/key_N.key  EXT-X-KEY 密钥代理
 */

const http = require('node:http');
const { URL } = require('node:url');

const { createLogger, toIso, sleep } = require('./utils');
const { getConfig } = require('./config');
const { cacheStats, buildCacheKey, setCache, getCache } = require('./cache');
const { createSession, getSession, listSessions, expireSession } = require('./session');
const { fetchBuffer } = require('./fetcher');
const { segmentExt } = require('./m3u8');

const log = createLogger('server');

/** MIME 映射 */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.m3u8': 'application/vnd.apple.mpegurl; charset=utf-8',
    '.ts': 'video/mp2t',
    '.m4s': 'video/iso.segment',
    '.mp4': 'video/mp4',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

/** CORS 头部（仅本地回环使用） */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

/**
 * 统一 JSON 响应
 * @param {http.ServerResponse} res
 * @param {number} code 业务码
 * @param {object} data
 * @param {number} [status=200] HTTP 状态码
 */
function jsonOk(res, code, data, status = 200) {
    const body = JSON.stringify({ code, data });
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS,
    });
    res.end(body);
}

/**
 * 错误 JSON 响应
 * @param {http.ServerResponse} res
 * @param {number} status HTTP 状态码
 * @param {string} message
 */
function jsonErr(res, status, message) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...CORS_HEADERS,
    });
    res.end(JSON.stringify({ code: -1, error: message }));
}

/**
 * 读取请求体（JSON）
 * @param {http.IncomingMessage} req
 * @returns {Promise<object>}
 */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            try {
                const txt = Buffer.concat(chunks).toString('utf8');
                resolve(txt ? JSON.parse(txt) : {});
            } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

/**
 * 等待会话 master 解析完成
 * @param {import('./session').Session} session
 * @param {number} [timeout=8000]
 * @returns {Promise<boolean>}
 */
async function waitForMaster(session, timeout = 8000) {
    const t0 = Date.now();
    while (!session.master && Date.now() - t0 < timeout) {
        await sleep(50);
    }
    return !!session.master;
}

/**
 * 创建并启动 HTTP 服务器（绑定 127.0.0.1）
 * @returns {Promise<http.Server>}
 */
function startServer() {
    const cfg = getConfig();

    const server = http.createServer(async (req, res) => {
        // CORS 预检
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                ...CORS_HEADERS,
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            });
            return res.end();
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;
        log.debug(`${req.method} ${pathname}`);

        try {
            // ===== API =====
            if (pathname === '/api/boost' && req.method === 'POST') {
                return await handleBoost(req, res);
            }
            if (pathname === '/api/boost/sessions' && req.method === 'GET') {
                return jsonOk(res, 0, { sessions: listSessions().map((s) => s.toJSON()) });
            }
            if (pathname === '/api/boost/stats' && req.method === 'GET') {
                return jsonOk(res, 0, globalStats());
            }

            const heartbeatMatch = pathname.match(/^\/api\/boost\/sessions\/([^/]+)\/heartbeat$/);
            if (heartbeatMatch && req.method === 'POST') {
                const s = getSession(heartbeatMatch[1]);
                if (!s) return jsonErr(res, 404, 'session not found');
                const body = await readJsonBody(req);
                s._heartbeat = body;
                return jsonOk(res, 0, { ok: true });
            }
            const sessionMatch = pathname.match(/^\/api\/boost\/sessions\/([^/]+)(\/expire)?$/);
            if (sessionMatch) {
                const id = sessionMatch[1];
                const action = sessionMatch[2];
                const s = getSession(id);
                if (!s) return jsonErr(res, 404, 'session not found');
                if (action === '/expire' && req.method === 'POST') {
                    await expireSession(id);
                    return jsonOk(res, 0, { expired: true });
                }
                return jsonOk(res, 0, s.toJSON());
            }

            // ===== 流代理 =====
            if (pathname.startsWith('/stream/')) {
                return await handleStream(req, res, pathname);
            }

            return jsonErr(res, 404, 'not found: ' + pathname);
        } catch (e) {
            log.error('请求处理异常:', e.message);
            if (!res.headersSent) jsonErr(res, 500, e.message);
        }
    });

    return new Promise((resolve, reject) => {
        server.on('error', (e) => {
            log.error('HTTP 服务启动失败:', e.message);
            reject(e);
        });
        server.listen(cfg.server.port, cfg.server.host, () => {
            log.info(`加速代理服务已启动: http://${cfg.server.host}:${cfg.server.port}`);
            resolve(server);
        });
    });
}

/**
 * POST /api/boost 创建加速会话
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleBoost(req, res) {
    const body = await readJsonBody(req);
    const sourceUrl = body.url;
    if (!sourceUrl || typeof sourceUrl !== 'string') {
        return jsonErr(res, 400, 'missing "url"');
    }
    const mode = ['auto', 'live', 'vod'].includes(body.mode) ? body.mode : 'auto';
    const cacheTtl = Number(body.cacheTtl) || 0;

    // 会话复用：同 sourceUrl 已存在且未过期则复用
    const existing = listSessions().find((s) => s.sourceUrl === sourceUrl && s.state !== 'expired');
    const session = existing || createSession(sourceUrl, mode, cacheTtl);

    return jsonOk(res, 0, {
        sessionId: session.id,
        playUrl: `/stream/${session.id}/master.m3u8`,
        expiresAt: toIso(session.createdAt + (session.isLive ? 30 : 300) * 1000),
        meta: {
            type: session.isLive ? 'live' : 'vod',
            duration: session._maxDuration ? session._maxDuration() : 0,
            bitrates: (session.master?.variants || []).map((v) => v.bandwidth),
            ready: session.state === 'ready',
        },
    });
}

/**
 * /stream/* 流代理路由
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
async function handleStream(req, res, pathname) {
    // /stream/{sid}/master.m3u8
    let m = pathname.match(/^\/stream\/([^/]+)\/master\.m3u8$/);
    if (m) {
        const s = getSession(m[1]);
        if (!s) return jsonErr(res, 404, 'session not found');
        s.touch(); s.activeUsers++;
        const ok = await waitForMaster(s);
        if (!ok) return jsonErr(res, 503, 'master preparing, retry later');
        const text = s.master.isMaster ? s.getRewrittenMaster() : s.getRewrittenMedia('index');
        res.writeHead(200, {
            'Content-Type': MIME['.m3u8'],
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
        });
        res.end(text);
        return;
    }

    // /stream/{sid}/{label}/index.m3u8
    m = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\/index\.m3u8$/);
    if (m) {
        const [, sid, label] = m;
        const s = getSession(sid);
        if (!s) return jsonErr(res, 404, 'session not found');
        s.touch(); s.activeUsers++;
        const t0 = Date.now();
        while (!s.getPlaylist(label) && Date.now() - t0 < 8000) await sleep(50);
        const text = s.getRewrittenMedia(label);
        if (!text) return jsonErr(res, 404, 'playlist not found: ' + label);
        res.writeHead(200, {
            'Content-Type': MIME['.m3u8'],
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
        });
        res.end(text);
        return;
    }

    // /stream/{sid}/{label}/segment_N.{ext}
    m = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\/segment_(\d+)(\.[a-zA-Z0-9]+)$/);
    if (m) {
        const [, sid, label, idxStr, ext] = m;
        const index = parseInt(idxStr, 10);
        const s = getSession(sid);
        if (!s) return jsonErr(res, 404, 'session not found');
        s.touch(); s.activeUsers++;
        s.stats.requests++;
        return await serveSegment(s, label, index, ext, req, res);
    }

    // /stream/{sid}/{label}/init.mp4
    m = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\/init\.mp4$/);
    if (m) {
        const [, sid, label] = m;
        const s = getSession(sid);
        if (!s) return jsonErr(res, 404, 'session not found');
        s.touch();
        const entry = s.getPlaylist(label);
        const initUrl = entry?.parsed?.initUrl;
        if (!initUrl) return jsonErr(res, 404, 'no init segment');
        const key = buildCacheKey(s.sourceHash, 'ts', `${label}:init`);
        const diskPath = s.segmentDiskPath(label, 'init.mp4');
        let data = await getCache(key, diskPath, 'ts');
        if (!data) {
            try {
                const r = await fetchBuffer(initUrl, { timeout: 30000 });
                data = r.buffer;
                await setCache(key, data, diskPath);
                s.stats.bytesFromOrigin += data.length;
            } catch (e) {
                return jsonErr(res, 502, 'fetch init failed: ' + e.message);
            }
        } else {
            s.stats.bytesFromCache += data.length;
        }
        res.writeHead(200, {
            'Content-Type': MIME['.mp4'],
            'Cache-Control': 'public, max-age=86400',
            ...CORS_HEADERS,
            'Content-Length': data.length,
        });
        res.end(data);
        return;
    }

    // /stream/{sid}/{label}/key_N.key  (EXT-X-KEY 密钥代理)
    m = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\/key_(\d+)\.key$/);
    if (m) {
        const [, sid, label, idxStr] = m;
        const s = getSession(sid);
        if (!s) return jsonErr(res, 404, 'session not found');
        s.touch();
        const origin = s.getKeyOriginUrl(label, pathname);
        if (!origin) return jsonErr(res, 404, 'key mapping not found: ' + pathname);
        const key = buildCacheKey(s.sourceHash, 'key', `${label}:${idxStr}`);
        const diskPath = s.segmentDiskPath(label, `key_${idxStr}.key`);
        let data = await getCache(key, diskPath);
        if (!data) {
            try {
                const r = await fetchBuffer(origin, { timeout: 15000 });
                data = r.buffer;
                await setCache(key, data, diskPath);
                s.stats.bytesFromOrigin += data.length;
                log.debug(`[${s.id}] 回源密钥 ${label} key_${idxStr} (${data.length}B)`);
            } catch (e) {
                return jsonErr(res, 502, 'fetch key failed: ' + e.message);
            }
        } else {
            s.stats.bytesFromCache += data.length;
        }
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
            ...CORS_HEADERS,
            'Content-Length': data.length,
        });
        res.end(data);
        return;
    }

    return jsonErr(res, 404, 'unknown stream path: ' + pathname);
}

/**
 * 提供分片：缓存命中直接返回，未命中回源并写缓存
 * @param {import('./session').Session} s
 * @param {string} label
 * @param {number} index
 * @param {string} ext
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function serveSegment(s, label, index, ext, req, res) {
    const data = await s.getSegment(label, index);
    if (data) {
        if (res.writableEnded || req.aborted) return;
        s.stats.bytesFromCache += data.length;
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'video/mp2t',
            'Cache-Control': 'public, max-age=86400',
            ...CORS_HEADERS,
            'Content-Length': data.length,
        });
        res.end(data);
        prefetchAheadSafe(s, label, index + 1);
        return;
    }
    // 未命中：回源
    const entry = s.getPlaylist(label);
    const seg = entry?.parsed?.segments?.[index];
    if (!seg) {
        if (!res.writableEnded && !req.aborted) jsonErr(res, 404, `segment ${index} not in playlist`);
        return;
    }
    try {
        const r = await fetchBuffer(seg.url, { timeout: 30000 });
        if (res.writableEnded || req.aborted) {
            log.debug(`[${s.id}] 客户端已断开，丢弃回源 ${label} #${index}`);
            return;
        }
        const key = buildCacheKey(s.sourceHash, 'ts', `${label}:${index}`);
        const fileName = `segment_${index}${segmentExt(seg.url)}`;
        const diskPath = s.segmentDiskPath(label, fileName);
        await s.cacheSegment(key, r.buffer, diskPath);
        s.stats.bytesFromOrigin += r.buffer.length;
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'video/mp2t',
            'Cache-Control': 'public, max-age=86400',
            ...CORS_HEADERS,
            'Content-Length': r.buffer.length,
        });
        res.end(r.buffer);
        prefetchAheadSafe(s, label, index + 1);
    } catch (e) {
        log.warn(`[${s.id}] 回源分片失败 ${label} #${index}:`, e.message);
        if (!res.headersSent && !req.aborted) jsonErr(res, 502, 'fetch segment failed: ' + e.message);
    }
}

/**
 * 安全触发预取（不抛错）
 * @param {import('./session').Session} s
 * @param {string} label
 * @param {number} fromIndex
 */
function prefetchAheadSafe(s, label, fromIndex) {
    if (!s._prefetch) return;
    s._prefetch.prefetchAhead(label, fromIndex, s.config.prefetch.initialSegments)
        .catch((e) => log.debug(`[${s.id}] 预取后续失败:`, e.message));
}

/**
 * 全局统计
 */
function globalStats() {
    const sessions = listSessions();
    const cs = cacheStats();
    let served = 0, fromCache = 0, fromOrigin = 0, requests = 0;
    for (const s of sessions) {
        served += s.stats.bytesServed;
        fromCache += s.stats.bytesFromCache;
        fromOrigin += s.stats.bytesFromOrigin;
        requests += s.stats.requests;
    }
    return {
        sessions: sessions.length,
        memory: cs.memory,
        disk: cs.disk,
        counters: cs.counters,
        bytesServed: served,
        bytesFromCache: fromCache,
        bytesFromOrigin: fromOrigin,
        requests,
        cacheHitRate: (fromCache + fromOrigin) > 0
            ? (fromCache / (fromCache + fromOrigin) * 100).toFixed(2) + '%'
            : '0%',
    };
}

module.exports = {
    startServer,
    globalStats,
};
