/**
 * 缓存管理模块
 * 提供数据的缓存存储、读取、删除和清理功能
 * 优化：内存 LRU（按字节淘汰） + 并发批量扫描 + 缩短清理间隔 + 批量并发读写
 */
const { read, write, exists, remove, getAllKeys } = require('../utils/files');

const CACHE_PREFIX = 'cache.';
const DEFAULT_EXPIRE = 24 * 60 * 60 * 1000; // 默认24小时过期

/** 内存缓存上限（字节，默认 64MB），超过后按 LRU 淘汰 */
const MEMORY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** 并发批量处理时的最大并发数 */
const BATCH_CONCURRENCY = 8;

// 内存缓存：Map 按插入顺序维护 LRU 语义（get/set 时 delete+set 重新插入）
const memoryCache = new Map();
/** 内存缓存当前估算字节数 */
let memoryCacheBytes = 0;

/**
 * 估算值的字节大小（优先用 Buffer.byteLength，回退到 JSON.stringify 长度）
 * @param {*} value
 * @returns {number}
 */
function estimateSize(value) {
    try {
        if (value === null || value === undefined) return 0;
        if (Buffer.isBuffer(value)) return value.length;
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        return Buffer.byteLength(str, 'utf8');
    } catch {
        return 0;
    }
}

/**
 * 获取缓存存储键名
 * @param {string} key - 缓存键
 * @returns {string} 存储键名
 */
function getStorageKey(key) {
    return `${CACHE_PREFIX}${key}`;
}

/**
 * 检查缓存是否过期
 * @param {Object} cacheData - 缓存数据对象
 * @returns {boolean} 是否过期
 */
function isExpired(cacheData) {
    if (!cacheData.expire) return false; // 永不过期
    return Date.now() > cacheData.expire;
}

/**
 * 内存 LRU 淘汰：按 Map 插入顺序从最旧开始删除，直到字节数低于上限
 * @returns {void}
 */
function evictMemoryCache() {
    if (memoryCacheBytes <= MEMORY_CACHE_MAX_BYTES) return;
    for (const [key, value] of memoryCache.entries()) {
        const size = value.__size || estimateSize(value);
        memoryCache.delete(key);
        memoryCacheBytes -= size;
        if (memoryCacheBytes <= MEMORY_CACHE_MAX_BYTES) break;
    }
    if (memoryCacheBytes < 0) memoryCacheBytes = 0;
}

/**
 * 清理过期的内存缓存
 * @returns {void}
 */
function cleanExpiredMemoryCache() {
    for (const [key, value] of memoryCache.entries()) {
        if (isExpired(value)) {
            const size = value.__size || estimateSize(value);
            memoryCache.delete(key);
            memoryCacheBytes -= size;
        }
    }
    if (memoryCacheBytes < 0) memoryCacheBytes = 0;
}

/**
 * 写入内存缓存（含 LRU 淘汰与字节数维护）
 * @param {string} key
 * @param {Object} cacheData
 * @returns {void}
 */
function setMemoryCache(key, cacheData) {
    const size = estimateSize(cacheData.data);
    cacheData.__size = size;
    // 若已存在，先扣除旧值字节数
    const existing = memoryCache.get(key);
    if (existing) {
        memoryCacheBytes -= existing.__size || 0;
    }
    memoryCache.set(key, cacheData);
    memoryCacheBytes += size;
    evictMemoryCache();
}

/**
 * 读取内存缓存（命中时重新插入以维护 LRU 顺序）
 * @param {string} key
 * @returns {Object|undefined}
 */
function getMemoryCache(key) {
    const value = memoryCache.get(key);
    if (value === undefined) return undefined;
    // 重新插入到 Map 末尾（LRU 语义）
    memoryCache.delete(key);
    memoryCache.set(key, value);
    return value;
}

/**
 * 删除内存缓存
 * @param {string} key
 * @returns {void}
 */
function deleteMemoryCache(key) {
    const value = memoryCache.get(key);
    if (value) {
        memoryCacheBytes -= value.__size || 0;
    }
    memoryCache.delete(key);
    if (memoryCacheBytes < 0) memoryCacheBytes = 0;
}

/**
 * 简单并发限制器
 * @param {Array<() => Promise>} fns
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function parallelLimit(fns, limit) {
    const results = new Array(fns.length);
    let cursor = 0;
    let active = 0;

    return new Promise((resolve, reject) => {
        const next = () => {
            if (cursor >= fns.length && active === 0) {
                resolve(results);
                return;
            }
            while (active < limit && cursor < fns.length) {
                const idx = cursor++;
                active++;
                Promise.resolve()
                    .then(() => fns[idx]())
                    .then((r) => { results[idx] = r; })
                    .catch((e) => { results[idx] = { __error: e }; })
                    .finally(() => { active--; next(); });
            }
        };
        next();
    });
}

/**
 * 写入缓存
 * @param {string} key - 缓存键
 * @param {*} data - 要缓存的数据
 * @param {number} [expire] - 过期时间（毫秒），不设置则使用默认值
 * @returns {Promise<boolean>} 写入是否成功
 */
async function set(key, data, expire = DEFAULT_EXPIRE) {
    try {
        if (!key) {
            throw new Error('缓存键不能为空');
        }

        const now = Date.now();
        const expireTime = expire > 0 ? now + expire : 0;

        const cacheData = {
            data,
            timestamp: now,
            expire: expireTime
        };

        // 更新内存缓存
        setMemoryCache(key, cacheData);

        // 写入磁盘缓存
        const storageKey = getStorageKey(key);
        return await write(storageKey, cacheData);
    } catch (error) {
        console.error('写入缓存失败:', error.message);
        return false;
    }
}

/**
 * 读取缓存
 * @param {string} key - 缓存键
 * @param {*} [defaultValue] - 默认值，当缓存不存在或过期时返回
 * @returns {Promise<*>} 缓存数据或默认值
 */
async function get(key, defaultValue = undefined) {
    try {
        if (!key) {
            return defaultValue;
        }

        // 先检查内存缓存
        if (memoryCache.has(key)) {
            const cacheData = getMemoryCache(key);
            if (cacheData && !isExpired(cacheData)) {
                return cacheData.data;
            }
            // 过期则删除内存缓存
            if (cacheData && isExpired(cacheData)) {
                deleteMemoryCache(key);
            }
        }

        // 检查磁盘缓存
        const storageKey = getStorageKey(key);
        const cacheData = await read(storageKey);

        if (!cacheData) {
            return defaultValue;
        }

        // 检查是否过期
        if (isExpired(cacheData)) {
            // 删除过期缓存
            await remove(storageKey);
            return defaultValue;
        }

        // 更新内存缓存
        setMemoryCache(key, cacheData);

        return cacheData.data;
    } catch (error) {
        console.error('读取缓存失败:', error.message);
        return defaultValue;
    }
}

/**
 * 删除指定缓存
 * @param {string} key - 缓存键
 * @returns {Promise<boolean>} 删除是否成功
 */
async function del(key) {
    try {
        if (!key) {
            return false;
        }

        // 删除内存缓存
        deleteMemoryCache(key);

        // 删除磁盘缓存
        const storageKey = getStorageKey(key);
        return await remove(storageKey);
    } catch (error) {
        console.error('删除缓存失败:', error.message);
        return false;
    }
}

/**
 * 并发处理磁盘缓存条目
 * @param {(key: string, cacheData: Object|null) => Promise<*>} handler
 * @returns {Promise<Array>}
 */
async function forEachDiskCacheEntry(handler) {
    const allKeys = await getAllKeys();
    const cacheKeys = allKeys.filter(k => k.startsWith(CACHE_PREFIX));

    const fns = cacheKeys.map((key) => async () => {
        try {
            const cacheData = await read(key);
            return await handler(key, cacheData);
        } catch (error) {
            return await handler(key, null, error);
        }
    });

    return parallelLimit(fns, BATCH_CONCURRENCY);
}

/**
 * 清理所有过期缓存并返回详细信息
 * @returns {Promise<Object>} 清理的详细信息
 */
async function cleanExpired() {
    try {
        const details = {
            memoryCleaned: [],
            diskCleaned: [],
            totalCount: 0,
            totalSize: 0,
            memoryCount: 0,
            diskCount: 0,
            memorySize: 0,
            diskSize: 0
        };

        // 清理内存缓存
        const beforeCount = memoryCache.size;
        for (const [key, value] of memoryCache.entries()) {
            if (isExpired(value)) {
                const size = value.__size || estimateSize(value);
                details.memoryCleaned.push({
                    key: key,
                    size: size,
                    expire: value.expire,
                    timestamp: value.timestamp
                });
                details.memorySize += size;
                deleteMemoryCache(key);
            }
        }
        details.memoryCount = beforeCount - memoryCache.size;

        // 并发清理磁盘缓存
        const results = await forEachDiskCacheEntry(async (key, cacheData, err) => {
            if (err) {
                // 读取失败的缓存也删除
                await remove(key);
                return {
                    key: key.replace(CACHE_PREFIX, ''),
                    size: 0,
                    expire: 0,
                    timestamp: 0,
                    error: '读取失败'
                };
            }
            if (cacheData && isExpired(cacheData)) {
                const size = estimateSize(cacheData.data);
                await remove(key);
                return {
                    key: key.replace(CACHE_PREFIX, ''),
                    size: size,
                    expire: cacheData.expire,
                    timestamp: cacheData.timestamp
                };
            }
            return null;
        });

        for (const r of results) {
            if (r) {
                details.diskCleaned.push(r);
                details.diskSize += r.size;
                details.diskCount++;
            }
        }

        // 统计总数
        details.totalCount = details.memoryCount + details.diskCount;
        details.totalSize = details.memorySize + details.diskSize;

        return details;
    } catch (error) {
        console.error('清理过期缓存失败:', error.message);
        return {
            memoryCleaned: [],
            diskCleaned: [],
            totalCount: 0,
            totalSize: 0,
            memoryCount: 0,
            diskCount: 0,
            memorySize: 0,
            diskSize: 0,
            error: error.message
        };
    }
}

/**
 * 清理所有缓存
 * @returns {Promise<number>} 清理的缓存数量
 */
async function cleanAll() {
    try {
        let cleanedCount = 0;

        // 清理内存缓存
        cleanedCount += memoryCache.size;
        memoryCache.clear();
        memoryCacheBytes = 0;

        // 并发清理磁盘缓存
        const allKeys = await getAllKeys();
        const cacheKeys = allKeys.filter(k => k.startsWith(CACHE_PREFIX));
        const fns = cacheKeys.map((key) => async () => {
            await remove(key);
            return 1;
        });
        const results = await parallelLimit(fns, BATCH_CONCURRENCY);
        cleanedCount += results.reduce((acc, n) => acc + (n || 0), 0);

        return cleanedCount;
    } catch (error) {
        console.error('清理所有缓存失败:', error.message);
        return 0;
    }
}

/**
 * 获取缓存统计信息
 * @returns {Promise<Object>} 缓存统计信息
 */
async function getStats() {
    try {
        const stats = {
            memoryCount: memoryCache.size,
            memoryBytes: memoryCacheBytes,
            diskCount: 0,
            expiredCount: 0,
            totalSize: memoryCacheBytes
        };

        // 并发统计磁盘缓存
        const results = await forEachDiskCacheEntry(async (key, cacheData, err) => {
            if (err || !cacheData) return null;
            const size = estimateSize(cacheData.data);
            const expired = isExpired(cacheData);
            return { size, expired };
        });

        for (const r of results) {
            if (r) {
                stats.diskCount++;
                stats.totalSize += r.size;
                if (r.expired) stats.expiredCount++;
            }
        }

        return stats;
    } catch (error) {
        console.error('获取缓存统计失败:', error.message);
        return {
            memoryCount: memoryCache.size,
            memoryBytes: memoryCacheBytes,
            diskCount: 0,
            expiredCount: 0,
            totalSize: memoryCacheBytes
        };
    }
}

/**
 * 检查缓存是否存在且未过期
 * @param {string} key - 缓存键
 * @returns {Promise<boolean>} 缓存是否存在且未过期
 */
async function has(key) {
    try {
        if (!key) {
            return false;
        }

        // 检查内存缓存
        if (memoryCache.has(key)) {
            const cacheData = getMemoryCache(key);
            return cacheData ? !isExpired(cacheData) : false;
        }

        // 检查磁盘缓存
        const storageKey = getStorageKey(key);
        const cacheData = await read(storageKey);

        if (!cacheData) {
            return false;
        }

        // 检查是否过期
        if (isExpired(cacheData)) {
            // 删除过期缓存
            await remove(storageKey);
            return false;
        }

        // 更新内存缓存
        setMemoryCache(key, cacheData);

        return true;
    } catch (error) {
        console.error('检查缓存存在性失败:', error.message);
        return false;
    }
}

/**
 * 批量设置缓存（并发写入，受 BATCH_CONCURRENCY 限制）
 * @param {Array<Object>} items - 缓存项数组，每项包含 {key, data, expire}
 * @returns {Promise<number>} 成功设置的缓存数量
 */
async function mset(items) {
    if (!Array.isArray(items)) {
        return 0;
    }

    const fns = items
        .filter(item => item && item.key)
        .map((item) => async () => {
            const result = await set(item.key, item.data, item.expire);
            return result ? 1 : 0;
        });

    const results = await parallelLimit(fns, BATCH_CONCURRENCY);
    return results.reduce((acc, n) => acc + (n || 0), 0);
}

/**
 * 批量获取缓存（并发读取，受 BATCH_CONCURRENCY 限制）
 * @param {Array<string>} keys - 缓存键数组
 * @returns {Promise<Object>} 键值对对象
 */
async function mget(keys) {
    if (!Array.isArray(keys)) {
        return {};
    }

    const validKeys = keys.filter(k => k);
    const fns = validKeys.map((key) => async () => {
        const value = await get(key);
        return { key, value };
    });

    const results = await parallelLimit(fns, BATCH_CONCURRENCY);
    const result = {};
    for (const r of results) {
        result[r.key] = r.value;
    }
    return result;
}

// 定期清理过期缓存（10 分钟一次，缩短自 1 小时）
setInterval(cleanExpiredMemoryCache, 10 * 60 * 1000);

module.exports = {
    set,
    get,
    del,
    cleanExpired,
    cleanAll,
    getStats,
    has,
    mset,
    mget
};
