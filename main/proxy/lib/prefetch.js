/**
 * @file 智能预取引擎：并行下载调度 + 自适应窗口
 *
 * 策略：
 *  - 起播阶段：预取窗口 = initialSegments，并发 = maxConcurrent
 *  - 稳定阶段：维持领先播放位置
 *  - 直播：按 targetDuration/2 刷新 playlist
 */

const { fetchText, fetchBuffer } = require('./fetcher');
const { parseM3U8, segmentExt } = require('./m3u8');
const { buildCacheKey } = require('./cache');
const { createLogger } = require('./utils');

const log = createLogger('prefetch');

/**
 * 预取引擎
 */
class PrefetchEngine {
    /**
     * @param {object} session 关联的会话对象
     */
    constructor(session) {
        this.session = session;
        this.cfg = session.config.prefetch;
        this.running = false;
        /** @type {Map<string, number>} 每个码率下一个待预取序号 */
        this.cursors = new Map();
        /** @type {Map<string, number>} 每个码率已预取总数 */
        this.totals = new Map();
        this.liveTimer = null;
        this.failures = 0;
    }

    /**
     * 启动预取：拉取 master/playlist，预取前 N 个分片
     * @returns {Promise<void>}
     */
    async start() {
        if (this.running) return;
        this.running = true;
        try {
            await this._fetchMaster();
            this.session.markState('ready');
            log.info(`[${this.session.id}] 会话就绪，开始预取 ${this.cfg.initialSegments} 个分片`);
            const labels = Array.from(this.totals.keys());
            await Promise.all(labels.map((l) => this._prefetchHead(l, this.cfg.initialSegments)));
        } catch (e) {
            log.error(`[${this.session.id}] 预取启动失败:`, e.message);
            this.session.markState('ready');
        }
    }

    /**
     * 拉取并解析主播放列表
     * @private
     */
    async _fetchMaster() {
        const s = this.session;
        const { text, finalUrl } = await fetchText(s.sourceUrl, { timeout: 15000 });
        s.finalUrl = finalUrl;
        s.masterText = text;
        s.master = parseM3U8(text, finalUrl);

        if (s.master.isMaster) {
            s.isLive = s.master.isLive;
            await Promise.all(
                s.master.variants.map((v) => this._fetchVariantPlaylist(v))
            );
        } else {
            const label = 'index';
            s.master.variants = [{
                url: finalUrl, bandwidth: 0, label, resolution: '', codecs: '',
            }];
            this._storePlaylist(label, text, s.master, finalUrl);
            s.isLive = s.master.isLive;
        }
    }

    /**
     * 拉取子 playlist 并缓存
     * @private
     * @param {{url:string,label:string,bandwidth:number}} v
     */
    async _fetchVariantPlaylist(v) {
        try {
            const { text, finalUrl } = await fetchText(v.url, { timeout: 15000 });
            const parsed = parseM3U8(text, finalUrl);
            this._storePlaylist(v.label, text, parsed, finalUrl);
            this.session.isLive = this.session.isLive || parsed.isLive;
        } catch (e) {
            log.warn(`[${this.session.id}] 拉取子playlist失败 ${v.label}:`, e.message);
        }
    }

    /**
     * @private
     * @param {string} label
     * @param {string} text
     * @param {object} parsed
     * @param {string} url
     */
    _storePlaylist(label, text, parsed, url) {
        this.session.setPlaylist(label, { text, parsed, url });
        this.cursors.set(label, 0);
        this.totals.set(label, parsed.segments.length);
    }

    /**
     * 预取某码率从游标开始的 n 个分片
     * @param {string} label
     * @param {number} n
     */
    async _prefetchHead(label, n) {
        const entry = this.session.getPlaylist(label);
        if (!entry) return;
        const segments = entry.parsed.segments;
        let cursor = this.cursors.get(label) || 0;
        const maxConcurrent = this.cfg.maxConcurrent || 6;
        /** @type {Promise[]} */ const tasks = [];

        for (let i = 0; i < n && cursor < segments.length; i++, cursor++) {
            const seg = segments[cursor];
            const key = buildCacheKey(this.session.sourceHash, 'ts', `${label}:${seg.index}`);
            if (this.session.hasSegment(key)) {
                this.session.recordPrefetch(cursor + 1, segments.length, label);
                continue;
            }
            tasks.push(this._downloadSegment(label, seg, key));
            if (tasks.length >= maxConcurrent) {
                await Promise.allSettled(tasks);
                tasks.length = 0;
                this.session.recordPrefetch(cursor + 1, segments.length, label);
            }
        }
        if (tasks.length) {
            await Promise.allSettled(tasks);
            this.session.recordPrefetch(cursor, segments.length, label);
        }
        this.cursors.set(label, cursor);
    }

    /**
     * 下载单个分片并写入缓存
     * @private
     * @param {string} label
     * @param {{url:string,index:number,duration:number}} seg
     * @param {string} key
     */
    async _downloadSegment(label, seg, key) {
        const t0 = Date.now();
        try {
            const { buffer } = await fetchBuffer(seg.url, { timeout: 30000 });
            const diskPath = this.session.segmentDiskPath(label, `segment_${seg.index}${segmentExt(seg.url)}`);
            await this.session.cacheSegment(key, buffer, diskPath);
            const dt = Date.now() - t0;
            this.session.recordStats(dt, true, label);
            this.failures = 0;
            log.debug(`[${this.session.id}] 预取 ${label} #${seg.index} (${buffer.length}B, ${dt}ms)`);
        } catch (e) {
            this.failures++;
            this.session.recordStats(Date.now() - t0, false, label);
            log.warn(`[${this.session.id}] 预取失败 ${label} #${seg.index}:`, e.message);
        }
    }

    /**
     * 预取指定码率、指定序号开始的若干分片（供播放器请求触发）
     * @param {string} label
     * @param {number} fromIndex
     * @param {number} [count]
     * @returns {Promise<void>}
     */
    async prefetchAhead(label, fromIndex, count) {
        const entry = this.session.getPlaylist(label);
        if (!entry) return;
        const segments = entry.parsed.segments;
        const n = count || this.cfg.initialSegments;
        /** @type {Promise[]} */ const tasks = [];
        const max = Math.min(fromIndex + n, segments.length);
        for (let i = fromIndex; i < max; i++) {
            const seg = segments[i];
            if (!seg) break;
            const key = buildCacheKey(this.session.sourceHash, 'ts', `${label}:${seg.index}`);
            if (this.session.hasSegment(key)) continue;
            tasks.push(this._downloadSegment(label, seg, key));
            if (tasks.length >= (this.cfg.maxConcurrent || 6)) {
                await Promise.allSettled(tasks);
                tasks.length = 0;
            }
        }
        if (tasks.length) await Promise.allSettled(tasks);
        this.cursors.set(label, Math.max(this.cursors.get(label) || 0, max));
        this.session.recordPrefetch(max, segments.length, label);
    }

    /**
     * 启动直播 playlist 刷新循环
     */
    startLiveRefresh() {
        if (this.liveTimer) return;
        const refresh = async () => {
            if (!this.running) return;
            try {
                await this._refreshLive();
            } catch (e) {
                log.warn(`[${this.session.id}] 直播刷新失败:`, e.message);
            }
            const entry = this.session.getPlaylist('index') || this.session.getPlaylist(this.session.master?.variants?.[0]?.label);
            const td = entry?.parsed?.targetDuration || 6;
            const ratio = this.cfg.liveRefreshIntervalRatio || 0.5;
            this.liveTimer = setTimeout(refresh, Math.max(1000, td * 1000 * ratio));
        };
        refresh();
    }

    /** @private */
    async _refreshLive() {
        const labels = Array.from(this.totals.keys());
        for (const label of labels) {
            const entry = this.session.getPlaylist(label);
            if (!entry) continue;
            const { text, finalUrl } = await fetchText(entry.url, { timeout: 15000 });
            const parsed = parseM3U8(text, finalUrl);
            const existing = new Set(entry.parsed.segments.map((s) => s.url));
            const newSegs = parsed.segments.filter((s) => !existing.has(s.url));
            if (newSegs.length) {
                entry.parsed.segments = parsed.segments;
                this.totals.set(label, parsed.segments.length);
                log.info(`[${this.session.id}] 直播新增 ${newSegs.length} 分片 (${label})`);
                for (const seg of newSegs) {
                    const key = buildCacheKey(this.session.sourceHash, 'ts', `${label}:${seg.index}`);
                    if (!this.session.hasSegment(key)) {
                        await this._downloadSegment(label, seg, key);
                    }
                }
            }
            this.session.setPlaylist(label, entry);
        }
    }

    /** 停止预取 */
    stop() {
        this.running = false;
        if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
    }
}

module.exports = { PrefetchEngine };
