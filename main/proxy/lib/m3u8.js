/**
 * @file M3U8 解析与重写
 *
 * 职责：
 *  - 解析 master playlist（多码率）与 media playlist（分片列表）
 *  - 判断点播 / 直播
 *  - 重写所有内部 URL 为 /stream/{sessionId}/... 形式
 */

const { resolveUrl, isHttpUrl } = require('./utils');

/**
 * @typedef {Object} VariantStream
 * @property {string} url           子播放列表绝对 URL
 * @property {number} bandwidth     带宽(bps)
 * @property {string} [resolution]  分辨率
 * @property {string} [codecs]      编解码
 * @property {string} label         用于路径的码率标签，如 "2000k"
 */

/**
 * @typedef {Object} Segment
 * @property {string}  url        分片绝对 URL
 * @property {number}  duration   时长(秒)
 * @property {string}  [title]    EXTINF 标题
 * @property {number}  index      在播放列表中的序号
 * @property {string}  [byterange]
 */

/**
 * @typedef {Object} ParsedPlaylist
 * @property {boolean}    isMaster        是否为主播放列表
 * @property {boolean}    isLive          是否为直播（无 #EXT-X-ENDLIST）
 * @property {number}     targetDuration  目标分片时长(秒)
 * @property {number}     mediaSequence   起始媒体序号
 * @property {number}     totalDuration   所有分片时长之和(秒)
 * @property {string}     [initUrl]       EXT-X-MAP 初始化段绝对 URL
 * @property {Array<{uri:string,method:string,iv?:string,keyformat?:string}>} [keys] EXT-X-KEY 列表
 * @property {VariantStream[]} variants   master 时的码率列表
 * @property {Segment[]}  segments        media 时的分片列表
 * @property {string[]}   rawLines        原始行（用于重写）
 */

/**
 * 解析 M3U8 文本
 * @param {string} text
 * @param {string} baseUrl 用于解析相对 URL
 * @returns {ParsedPlaylist}
 */
function parseM3U8(text, baseUrl) {
    const lines = text.split(/\r?\n/);
    /** @type {VariantStream[]} */ const variants = [];
    /** @type {Segment[]} */ const segments = [];
    let isMaster = false;
    let isLive = true;
    let targetDuration = 0;
    let mediaSequence = 0;
    let totalDuration = 0;

    let pendingBandwidth = 0;
    let pendingResolution = '';
    let pendingCodecs = '';

    let segDuration = 0;
    let segTitle = '';
    let segByterange = '';
    let segIndex = 0;
    /** @type {string|undefined} */ let initUrl;
    /** @type {Array<{uri:string,method:string,iv?:string,keyformat?:string}>} */ const keys = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (!line.startsWith('#')) {
            if (isMaster && pendingBandwidth > 0) {
                variants.push({
                    url: resolveUrl(baseUrl, line),
                    bandwidth: pendingBandwidth,
                    resolution: pendingResolution || undefined,
                    codecs: pendingCodecs || undefined,
                    label: bitrateLabel(pendingBandwidth),
                });
                pendingBandwidth = 0; pendingResolution = ''; pendingCodecs = '';
            } else if (!isMaster) {
                segments.push({
                    url: resolveUrl(baseUrl, line),
                    duration: segDuration,
                    title: segTitle,
                    byterange: segByterange || undefined,
                    index: segIndex++,
                });
                totalDuration += segDuration;
                segDuration = 0; segTitle = ''; segByterange = '';
            }
            continue;
        }

        if (line.startsWith('#EXT-X-STREAM-INF')) {
            isMaster = true;
            const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
            pendingBandwidth = parseInt(attrs.BANDWIDTH || '0', 10);
            pendingResolution = attrs.RESOLUTION || '';
            pendingCodecs = attrs.CODECS || '';
        } else if (line.startsWith('#EXTINF')) {
            const body = line.slice('#EXTINF:'.length);
            const [dur, ...titleParts] = body.split(',');
            segDuration = parseFloat(dur) || 0;
            segTitle = titleParts.join(',').trim();
        } else if (line.startsWith('#EXT-X-TARGETDURATION')) {
            targetDuration = parseInt(line.split(':')[1], 10) || 0;
        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
            mediaSequence = parseInt(line.split(':')[1], 10) || 0;
        } else if (line.startsWith('#EXT-X-ENDLIST')) {
            isLive = false;
        } else if (line.startsWith('#EXT-X-BYTERANGE')) {
            segByterange = line.split(':')[1];
        } else if (line.startsWith('#EXT-X-MAP')) {
            const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
            if (attrs.URI) initUrl = resolveUrl(baseUrl, attrs.URI);
        } else if (line.startsWith('#EXT-X-KEY')) {
            const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
            if (attrs.URI && attrs.METHOD && attrs.METHOD !== 'NONE') {
                keys.push({
                    uri: resolveUrl(baseUrl, attrs.URI),
                    method: attrs.METHOD,
                    iv: attrs.IV,
                    keyformat: attrs.KEYFORMAT,
                });
            }
        }
    }

    return {
        isMaster,
        isLive,
        targetDuration,
        mediaSequence,
        totalDuration,
        initUrl,
        keys,
        variants,
        segments,
        rawLines: lines,
    };
}

/**
 * 解析属性字符串 `KEY=VALUE,KEY2="STR"` 为对象
 * @param {string} str
 * @returns {Object<string,string>}
 */
function parseAttributes(str) {
    /** @type {Object<string,string>} */ const out = {};
    let i = 0;
    while (i < str.length) {
        const eq = str.indexOf('=', i);
        if (eq < 0) break;
        const key = str.slice(i, eq).trim();
        i = eq + 1;
        if (str[i] === '"') {
            const end = str.indexOf('"', i + 1);
            out[key] = str.slice(i + 1, end);
            i = end + 2;
        } else {
            const comma = str.indexOf(',', i);
            const val = comma < 0 ? str.slice(i) : str.slice(i, comma);
            out[key] = val.trim();
            i = comma < 0 ? str.length : comma + 1;
        }
    }
    return out;
}

/**
 * 由带宽生成码率标签
 * @param {number} bandwidth
 * @returns {string} 如 "2000k"
 */
function bitrateLabel(bandwidth) {
    const k = Math.max(1, Math.round(bandwidth / 1000));
    return `${k}k`;
}

/**
 * 重写 master playlist：将子 playlist URL 替换为代理路径
 * @param {string} text 原始文本
 * @param {string} sessionId
 * @param {string} baseUrl
 * @returns {string}
 */
function rewriteMaster(text, sessionId, baseUrl) {
    const parsed = parseM3U8(text, baseUrl);
    if (!parsed.isMaster) {
        return rewriteMedia(text, sessionId, baseUrl, 'index');
    }
    const lines = parsed.rawLines;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#') && line.trim()) {
            const abs = resolveUrl(baseUrl, line);
            const v = parsed.variants.find((x) => x.url === abs);
            if (v) {
                out.push(`/stream/${sessionId}/${v.label}/index.m3u8`);
                continue;
            }
        }
        out.push(line);
    }
    return out.join('\n');
}

/**
 * 重写 media playlist：将分片 URL 替换为代理路径
 * @param {string} text 原始文本
 * @param {string} sessionId
 * @param {string} baseUrl
 * @param {string} label 码率标签（master 时）或 "index"
 * @param {Object} [opts]
 * @param {number} [opts.firstSegmentIndex=0] 起始序号（用于重切片场景）
 * @param {Map<string,string>} [opts.keyMap] 密钥代理路径 -> 原始 URL 映射
 * @returns {string}
 */
function rewriteMedia(text, sessionId, baseUrl, label, opts = {}) {
    const parsed = parseM3U8(text, baseUrl);
    const startIdx = opts.firstSegmentIndex || 0;
    const lines = parsed.rawLines;
    const out = [];
    let segCounter = startIdx;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#') && line.trim()) {
            out.push(`/stream/${sessionId}/${label}/segment_${segCounter}.ts`);
            segCounter++;
            continue;
        }
        if (line.startsWith('#EXT-X-MAP')) {
            const rewritten = line.replace(/URI="([^"]+)"/g, () => {
                return `URI="/stream/${sessionId}/${label}/init.mp4"`;
            });
            out.push(rewritten);
            continue;
        }
        if (line.startsWith('#EXT-X-KEY')) {
            const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
            if (attrs.URI && attrs.METHOD && attrs.METHOD !== 'NONE' && opts.keyMap) {
                const origin = resolveUrl(baseUrl, attrs.URI);
                const keyIdx = opts.keyMap.size;
                const proxyPath = `/stream/${sessionId}/${label}/key_${keyIdx}.key`;
                opts.keyMap.set(proxyPath, origin);
                out.push(line.replace(/URI="[^"]*"/, `URI="${proxyPath}"`));
            } else {
                out.push(line);
            }
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}

/**
 * 提取原始分片文件名后缀（.ts / .m4s / .aac ...），默认 .ts
 * @param {string} url
 * @returns {string}
 */
function segmentExt(url) {
    const m = url.match(/(\.[a-zA-Z0-9]+)(\?|$)/);
    return m ? m[1].toLowerCase() : '.ts';
}

module.exports = {
    parseM3U8,
    rewriteMaster,
    rewriteMedia,
    bitrateLabel,
    segmentExt,
    isHttpUrl,
};
