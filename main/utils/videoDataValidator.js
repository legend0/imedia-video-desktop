/**
 * 影视数据验证和转换工具
 * 用于处理API返回的影视数据格式，转换为应用内部使用的格式
 */
const log = require('./log');

/**
 * 标准影视数据字段映射
 * 将API返回的字段名映射到应用内部使用的字段名
 */
const FIELD_MAPPING = {
    // 基本信息映射
    vod_id: 'videoId',
    vod_name: 'title',
    vod_sub: 'subtitle',
    vod_en: 'englishTitle',
    vod_pic: 'pic',
    vod_pic_thumb: 'picThumb',
    vod_pic_slide: 'picSlide',
    vod_pic_screenshot: 'picScreenshot',
    vod_actor: 'actor',
    vod_director: 'director',
    vod_writer: 'writer',
    vod_behind: 'behind',
    vod_blurb: 'blurb',
    vod_remarks: 'remarks',
    vod_pubdate: 'pubdate',
    vod_total: 'total',
    vod_serial: 'serial',
    vod_tv: 'tv',
    vod_weekday: 'weekday',
    vod_area: 'area',
    vod_lang: 'lang',
    vod_year: 'year',
    vod_version: 'version',
    vod_state: 'state',
    vod_author: 'author',
    vod_jumpurl: 'jumpurl',
    vod_tpl: 'tpl',
    vod_tpl_play: 'tplPlay',
    vod_tpl_down: 'tplDown',
    vod_isend: 'isEnd',
    vod_lock: 'lock',
    vod_level: 'level',
    vod_copyright: 'copyright',
    vod_points: 'points',
    vod_points_play: 'pointsPlay',
    vod_points_down: 'pointsDown',
    vod_hits: 'hits',
    vod_hits_day: 'hitsDay',
    vod_hits_week: 'hitsWeek',
    vod_hits_month: 'hitsMonth',
    vod_duration: 'duration',
    vod_up: 'up',
    vod_down: 'down',
    vod_score: 'score',
    vod_score_all: 'scoreAll',
    vod_score_num: 'scoreNum',
    vod_time: 'time',
    vod_time_add: 'timeAdd',
    vod_time_hits: 'timeHits',
    vod_time_make: 'timeMake',
    vod_trysee: 'trysee',
    vod_douban_id: 'doubanId',
    vod_douban_score: 'doubanScore',
    vod_reurl: 'reurl',
    vod_rel_vod: 'relVod',
    vod_rel_art: 'relArt',
    vod_pwd: 'pwd',
    vod_pwd_url: 'pwdUrl',
    vod_pwd_play: 'pwdPlay',
    vod_pwd_play_url: 'pwdPlayUrl',
    vod_pwd_down: 'pwdDown',
    vod_pwd_down_url: 'pwdDownUrl',
    vod_content: 'content',
    vod_play_from: 'playFrom',
    vod_play_server: 'playServer',
    vod_play_note: 'playNote',
    vod_play_url: 'playUrl',
    vod_down_from: 'downFrom',
    vod_down_server: 'downServer',
    vod_down_note: 'downNote',
    vod_down_url: 'downUrl',
    vod_plot: 'plot',
    vod_plot_name: 'plotName',
    vod_plot_detail: 'plotDetail',
    type_id: 'typeId',
    type_id_1: 'typeId1',
    group_id: 'groupId',
    vod_color: 'color',
    vod_tag: 'tag',
    vod_class: 'class',
    vod_letter: 'letter',
    type_name: 'typeName'
};

/**
 * 验证影视数据的基本字段
 * @param {Object} videoData - 影视数据
 * @returns {Object} 验证结果
 */
function validateVideoData(videoData) {
    if (!videoData || typeof videoData !== 'object') {
        return { valid: false, error: '影视数据必须是一个对象' };
    }
    
    // 检查必要字段
    const requiredFields = ['vod_id', 'vod_name'];
    for (const field of requiredFields) {
        if (!videoData[field]) {
            return { valid: false, error: `缺少必要字段: ${field}` };
        }
    }
    
    return { valid: true };
}

/**
 * 将API返回的影视数据转换为应用内部格式
 * @param {Object} apiData - API返回的影视数据
 * @param {string} [sourceKey] - 源键名
 * @returns {Object} 转换后的影视数据
 */
function transformVideoData(apiData, sourceKey = null) {
    try {
        // 验证输入数据
        const validation = validateVideoData(apiData);
        if (!validation.valid) {
            log.warn(`影视数据验证失败: ${validation.error}`);
            return null;
        }
        
        // 创建转换后的数据对象
        const transformedData = {
            sourceKey: sourceKey
        };
        
        // 映射字段
        for (const [apiField, appField] of Object.entries(FIELD_MAPPING)) {
            if (apiData.hasOwnProperty(apiField)) {
                transformedData[appField] = apiData[apiField];
            }
        }
        
        // 处理特殊字段
        // 确保videoId是字符串
        if (transformedData.videoId) {
            transformedData.videoId = String(transformedData.videoId);
        }
        
        // 处理播放URL，将字符串转换为数组
        if (transformedData.playUrl && typeof transformedData.playUrl === 'string') {
            transformedData.playUrls = parsePlayUrls(transformedData.playUrl);
        }
        
        // 处理年份，确保是数字
        if (transformedData.year && typeof transformedData.year === 'string') {
            const year = parseInt(transformedData.year, 10);
            if (!isNaN(year)) {
                transformedData.year = year;
            }
        }
        
        // 处理分数，确保是数字
        if (transformedData.score && typeof transformedData.score === 'string') {
            const score = parseFloat(transformedData.score);
            if (!isNaN(score)) {
                transformedData.score = score;
            }
        }
        
        // 处理是否完结
        if (transformedData.isEnd !== undefined) {
            transformedData.isEnd = Boolean(transformedData.isEnd);
        }
        
        // 添加转换时间戳
        transformedData.transformedAt = Date.now();
        
        return transformedData;
    } catch (error) {
        log.error(`转换影视数据失败: ${error.message}`, error);
        return null;
    }
}

/**
 * 解析播放URL字符串
 * @param {string} playUrlStr - 播放URL字符串
 * @returns {Array} 解析后的播放URL数组
 */
function parsePlayUrls(playUrlStr) {
    try {
        if (!playUrlStr || typeof playUrlStr !== 'string') {
            return [];
        }
        
        // 按分隔符分割
        const segments = playUrlStr.split('#');
        const playUrls = [];
        
        for (const segment of segments) {
            if (!segment.trim()) continue;
            
            // 查找$符号分割标题和URL
            const dollarIndex = segment.indexOf('$');
            if (dollarIndex > 0) {
                const title = segment.substring(0, dollarIndex).trim();
                const url = segment.substring(dollarIndex + 1).trim();
                
                if (title && url) {
                    playUrls.push({
                        title,
                        url: url.replace(/^`|`$/g, '') // 移除首尾的反引号
                    });
                }
            } else if (segment.trim()) {
                // 如果没有$符号，整个作为URL
                playUrls.push({
                    title: `播放${playUrls.length + 1}`,
                    url: segment.trim().replace(/^`|`$/g, '')
                });
            }
        }
        
        return playUrls;
    } catch (error) {
        log.error(`解析播放URL失败: ${error.message}`, error);
        return [];
    }
}

/**
 * 批量转换影视数据
 * @param {Array} apiDataList - API返回的影视数据列表
 * @param {string} [sourceKey] - 源键名
 * @returns {Array} 转换后的影视数据列表
 */
function batchTransformVideoData(apiDataList, sourceKey = null) {
    try {
        if (!Array.isArray(apiDataList)) {
            log.warn('批量转换影视数据失败: 输入不是数组');
            return [];
        }
        
        const transformedList = [];
        
        for (const apiData of apiDataList) {
            const transformedData = transformVideoData(apiData, sourceKey);
            if (transformedData) {
                transformedList.push(transformedData);
            }
        }
        
        log.info(`批量转换影视数据完成，成功转换 ${transformedList.length}/${apiDataList.length} 条数据`);
        return transformedList;
    } catch (error) {
        log.error(`批量转换影视数据失败: ${error.message}`, error);
        return [];
    }
}

/**
 * 从转换后的影视数据中提取收藏/历史所需的基本信息
 * @param {Object} videoData - 转换后的影视数据
 * @returns {Object} 提取的基本信息
 */
function extractBasicVideoInfo(videoData) {
    if (!videoData) {
        return null;
    }
    
    return {
        videoId: videoData.videoId,
        title: videoData.title,
        pic: videoData.pic || '',
        url: videoData.playUrls && videoData.playUrls.length > 0 ? videoData.playUrls[0].url : '',
        sourceKey: videoData.sourceKey,
        // 添加一些额外的有用信息
        year: videoData.year || '',
        area: videoData.area || '',
        remarks: videoData.remarks || '',
        typeName: videoData.typeName || ''
    };
}

module.exports = {
    validateVideoData,
    transformVideoData,
    batchTransformVideoData,
    extractBasicVideoInfo,
    parsePlayUrls,
    FIELD_MAPPING
};