/**
 * @file 多层缓存体系：内存热缓存(LRU) + 磁盘温缓存
 *
 * 缓存键设计：{sourceHash}:{resourceType}:{identifier}
 *   例：abc123:m3u8:master、abc123:m3u8:800k、abc123:ts:800k:42
 *
 * 磁盘缓存目录：{storage}/cache/proxy/{sessionId}/...
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createLogger, formatBytes, sanitizeFileName } = require('./utils');
const { getConfig } = require('./config');

const log = createLogger('cache');

/**
 * 内存 LRU 缓存（按字节数淘汰）
 */
class MemoryLRU {
    /** @param {number} maxBytes */ constructor(maxBytes) {
        this.maxBytes = maxBytes;
        /** @type {Map<string, {data:Buffer, size:number, ts:number}>} */
        this.map = new Map();
        this.used = 0;
        this.hits = 0;
        this.miss = 0;
    }
    /** @param {number} max */ setMax(max) { this.maxBytes = max; this.evict(); }

    has(key) { return this.map.has(key); }

    /**
     * @param {string} key
     * @returns {Buffer|undefined}
     */
    get(key) {
        const e = this.map.get(key);
        if (!e) { this.miss++; return undefined; }
        this.map.delete(key);
        this.map.set(key, e);
        e.ts = Date.now();
        this.hits++;
        return e.data;
    }

    /**
     * @param {string} key
     * @param {Buffer} data
     */
    set(key, data) {
        if (!Buffer.isBuffer(data)) data = Buffer.from(data);
        const size = data.length;
        const old = this.map.get(key);
        if (old) this.used -= old.size;
        this.map.set(key, { data, size, ts: Date.now() });
        this.used += size;
        this.evict();
    }

    delete(key) {
        const e = this.map.get(key);
        if (!e) return;
        this.map.delete(key);
        this.used -= e.size;
    }

    evict() {
        if (this.used <= this.maxBytes) return;
        for (const [key, e] of this.map) {
            this.map.delete(key);
            this.used -= e.size;
            if (this.used <= this.maxBytes) break;
        }
    }

    clear() { this.map.clear(); this.used = 0; }
    stats() {
        return { size: this.map.size, bytes: this.used, maxBytes: this.maxBytes, hits: this.hits, miss: this.miss };
    }
}

/** 磁盘缓存管理 */
class DiskCache {
    constructor() {
        this.root = '';
        this.maxBytes = 0;
        this.used = 0;
        this.initialized = false;
    }

    /**
     * 初始化磁盘缓存目录
     * @param {string} root
     * @param {number} maxBytes
     */
    async init(root, maxBytes) {
        this.root = root;
        this.maxBytes = maxBytes;
        await fsp.mkdir(root, { recursive: true });
        this.used = await this._scan();
        this.initialized = true;
        log.info(`磁盘缓存就绪: ${root}, 已用 ${formatBytes(this.used)} / ${formatBytes(maxBytes)}`);
    }

    /**
     * 递归扫描目录占用字节数
     * @param {string} [dir]
     * @returns {Promise<number>}
     */
    async _scan(dir = this.root) {
        try {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            let total = 0;
            for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) total += await this._scan(p);
                else { const s = await fsp.stat(p); total += s.size; }
            }
            return total;
        } catch { return 0; }
    }

    /**
     * 生成会话专属目录的绝对路径
     * @param {string} sessionId
     * @returns {string}
     */
    sessionDir(sessionId) {
        return path.join(this.root, sanitizeFileName(sessionId));
    }

    /**
     * 写入文件
     * @param {string} absPath
     * @param {Buffer} data
     */
    async write(absPath, data) {
        await fsp.mkdir(path.dirname(absPath), { recursive: true });
        await fsp.writeFile(absPath, data);
        this.used += data.length;
        this._scheduleEvict();
    }

    /**
     * 读取文件
     * @param {string} absPath
     * @returns {Promise<Buffer|null>}
     */
    async read(absPath) {
        try { return await fsp.readFile(absPath); } catch { return null; }
    }

    /** @param {string} absPath */ exists(absPath) { return fs.existsSync(absPath); }

    /**
     * 删除整个会话目录
     * @param {string} sessionId
     */
    async removeSession(sessionId) {
        const dir = this.sessionDir(sessionId);
        const size = await this._scan(dir);
        try {
            await fsp.rm(dir, { recursive: true, force: true });
            this.used = Math.max(0, this.used - size);
            log.debug(`已清理会话缓存: ${sessionId} (${formatBytes(size)})`);
        } catch (e) {
            log.warn(`清理会话缓存失败 ${sessionId}:`, e.message);
        }
    }

    _scheduleEvict() {
        if (this.used <= this.maxBytes) return;
        clearTimeout(this._evictT);
        this._evictT = setTimeout(() => this._evictOldSessions().catch(e => log.warn('磁盘清理失败:', e.message)), 1000);
    }

    /** 按会话目录最近修改时间淘汰最旧的，直到低于阈值 */
    async _evictOldSessions() {
        try {
            const entries = await fsp.readdir(this.root, { withFileTypes: true });
            /** @type {{name:string, mtime:number, size:number}[]} */
            const dirs = [];
            for (const e of entries) {
                if (!e.isDirectory()) continue;
                const p = path.join(this.root, e.name);
                const st = await fsp.stat(p);
                dirs.push({ name: e.name, mtime: st.mtimeMs, size: await this._scan(p) });
            }
            dirs.sort((a, b) => a.mtime - b.mtime);
            for (const d of dirs) {
                if (this.used <= this.maxBytes) break;
                await fsp.rm(path.join(this.root, d.name), { recursive: true, force: true });
                this.used = Math.max(0, this.used - d.size);
                log.info(`磁盘缓存淘汰会话: ${d.name} (${formatBytes(d.size)})`);
            }
        } catch (e) { log.warn('磁盘清理异常:', e.message); }
    }

    stats() { return { bytes: this.used, maxBytes: this.maxBytes, root: this.root }; }
}

/** 单例：内存 LRU（延迟初始化） */
const memoryCache = new MemoryLRU(200 * 1024 * 1024);
/** 单例：磁盘缓存 */
const diskCache = new DiskCache();

/**
 * 初始化缓存（启动时调用，需在 app ready 后）
 * 若启动时已超容量（例如上次崩溃留下的孤儿目录），立即触发一轮淘汰
 */
async function initCache() {
    const cfg = getConfig();
    memoryCache.setMax(cfg.cache.memory.maxBytes);
    await diskCache.init(cfg.cache.disk.absPath, cfg.cache.disk.maxBytes);
    if (diskCache.used > diskCache.maxBytes) {
        log.warn(`启动时磁盘缓存已超阈值 ${formatBytes(diskCache.used)} > ${formatBytes(diskCache.maxBytes)}，立即清理`);
        await diskCache._evictOldSessions();
    }
}

/** 命中/未命中计数（全局） */
const counters = { m3u8: { hit: 0, miss: 0 }, ts: { hit: 0, miss: 0 } };

/**
 * 构造缓存键
 * @param {string} sourceHash 源 URL 哈希
 * @param {'m3u8'|'ts'} type 资源类型
 * @param {string} id 标识符
 * @returns {string}
 */
function buildCacheKey(sourceHash, type, id) {
    return `${sourceHash}:${type}:${id}`;
}

/**
 * 读取资源：内存 -> 磁盘 -> 未命中
 * @param {string} key
 * @param {string} [diskPath]
 * @param {'m3u8'|'ts'} [kind]
 * @returns {Promise<Buffer|null>}
 */
async function getCache(key, diskPath, kind) {
    const mem = memoryCache.get(key);
    if (mem) { if (kind) counters[kind].hit++; return mem; }
    if (diskPath && diskCache.exists(diskPath)) {
        const data = await diskCache.read(diskPath);
        if (data) {
            memoryCache.set(key, data);
            if (kind) counters[kind].hit++;
            return data;
        }
    }
    if (kind) counters[kind].miss++;
    return null;
}

/**
 * 写入资源：内存 + 磁盘（若提供路径）
 * @param {string} key
 * @param {Buffer} data
 * @param {string} [diskPath]
 */
async function setCache(key, data, diskPath) {
    memoryCache.set(key, data);
    if (diskPath) {
        try { await diskCache.write(diskPath, data); } catch (e) { log.warn('磁盘写入失败:', e.message); }
    }
}

/**
 * 删除某个会话的全部缓存
 * @param {string} sessionId
 */
async function clearSessionCache(sessionId) {
    await diskCache.removeSession(sessionId);
}

/** 返回缓存统计 */
function cacheStats() {
    return {
        memory: memoryCache.stats(),
        disk: diskCache.stats(),
        counters,
    };
}

module.exports = {
    memoryCache,
    diskCache,
    initCache,
    buildCacheKey,
    getCache,
    setCache,
    clearSessionCache,
    cacheStats,
};
