/**
 * 视频引擎
 * 负责通过当前视频源获取分类和影视列表
 * 集成缓存功能提高性能
 */
const { getCurrentSource } = require('./sourceManager');
const { get, post } = require('../utils/http');
const cache = require('./cache');
const { getAllKeys } = require('../utils/files');
const crypto = require('crypto');
const { extractBasicVideoInfo } = require('../utils/videoDataValidator');
const { getFormattedCategories } = require('../utils/categoryFormatter');
const settings = require('./settings');
const logger = require('../utils/log');

// 缓存过期时间设置
const CACHE_EXPIRE = {
    categories: 24 * 60 * 60 * 1000,  // 分类缓存24小时
    videoList: 2 * 60 * 60 * 1000,    // 视频列表缓存2小时
    search: 1 * 60 * 60 * 1000,       // 搜索结果缓存1小时
    videoDetail: 6 * 60 * 60 * 1000    // 视频详情缓存6小时
};

/**
 * 生成标准化的缓存键
 * @param {string} type - 缓存类型 (categories, videos, search, detail, recent)
 * @param {string} sourceKey - 视频源键名
 * @param {Object|String|Number} identifier - 标识符，可以是对象、字符串或数字
 * @param {Object} [options] - 选项，可以包含设置信息
 * @returns {string} 标准化的缓存键
 */
function generateCacheKey(type, sourceKey, identifier = '', options = {}) {
    // 基础键名
    let key = `${type}_${sourceKey}`;
    
    // 处理标识符
    if (identifier) {
        if (typeof identifier === 'object') {
            // 对象类型，排序后生成哈希
            const sortedKeys = Object.keys(identifier).sort();
            const sortedObj = {};
            sortedKeys.forEach(k => {
                sortedObj[k] = identifier[k];
            });
            const hash = crypto.createHash('md5').update(JSON.stringify(sortedObj)).digest('hex');
            key += `_${hash}`;
        } else {
            // 字符串或数字类型
            key += `_${identifier}`;
        }
    }
    
    // 添加设置信息到缓存键（确保设置变更时缓存失效）
    if (options.includeSettings) {
        const settingsHash = crypto.createHash('md5').update(JSON.stringify(options.settings || {})).digest('hex');
        key += `_settings_${settingsHash}`;
    }
    
    return key;
}

/**
 * 构建API URL
 * @param {Object} source - 视频源对象
 * @param {Object} params - 请求参数
 * @returns {string} 完整的API URL
 */
function buildApiUrl(source, params = {}) {
    let url = source.url + source.path;
    
    // 如果已有查询参数，添加&
    if (url.includes('?')) {
        url += '&';
    } else {
        url += '?';
    }
    
    // 添加参数
    const paramPairs = [];
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            paramPairs.push(`${key}=${encodeURIComponent(value)}`);
        }
    }
    
    return url + paramPairs.join('&');
}

/**
 * 获取视频分类
 * @param {boolean} [useCache=true] - 是否使用缓存
 * @returns {Promise<Array>} 分类列表
 */
async function getCategories(useCache = true) {
    try {
        // 获取当前激活的视频源
        const currentSource = await getCurrentSource();
        if (!currentSource) {
            throw new Error('没有可用的视频源');
        }
        
        // 构建缓存键（包含设置信息，确保设置变更时缓存失效）
        const showAdultContent = await settings.getSetting('ui.showAdult', false);
        
        const cacheKey = generateCacheKey('categories', currentSource.key, '', { 
            includeSettings: true,
            settings: { showAdultContent }
        }); 
        
        // 尝试从缓存获取
        if (useCache) {
            const cachedData = await cache.get(cacheKey);
            if (cachedData) {
                return cachedData;
            }
        }
        
        // 构建请求URL
        const apiUrl = buildApiUrl(currentSource, { ac: 'list' });
        // 发送请求
        let response;
        if (currentSource.type === 'json') {
            response = await get(apiUrl, { timeout: 10000 });
        } else {
            // 对于XML类型，可能需要特殊处理
            response = await get(apiUrl, { timeout: 10000 });
        }
        // 解析响应数据
        let apiCategories = [];
        if (currentSource.type === 'json') {
            // JSON格式解析
            if (response && response.class) {
                apiCategories = response.class;
            } else if (Array.isArray(response)) {
                apiCategories = response;
            }
        } else {
            // XML格式解析（这里简化处理，实际可能需要XML解析库）
            if (response && typeof response === 'string') {
                try {
                    // 尝试解析为JSON
                    const jsonData = JSON.parse(response);
                    apiCategories = jsonData.class || [];
                } catch (e) {
                    logger.warn(`解析分类数据失败: ${e.message}`);
                }
            }
        }
        // 格式化分类数据
        const formattedCategories = await getFormattedCategories(apiCategories, currentSource.isAdult || false);
        // 缓存结果
        if (formattedCategories.length > 0) {
            await cache.set(cacheKey, formattedCategories, CACHE_EXPIRE.categories);
        }
        
        return formattedCategories;
    } catch (error) {
        logger.error(`获取视频分类失败: ${error.message}`);
        return [];
    }
}

/**
 * 获取视频列表
 * @param {string} categoryId - 查询id，可以为空或者id,id2
 * @param {Object} options - 查询选项
 * @param {number} [options.t] - 分类ID
 * @param {number} [options.pg] - 页码，默认为1
 * @param {boolean} [useCache=true] - 是否使用缓存
 * @returns {Promise<Object>} 视频列表对象
 */
async function getVideos(categoryId,options = {}, useCache = true) {
    try {
        // 获取当前激活的视频源
        const currentSource = await getCurrentSource();
        if (!currentSource) {
            throw new Error('没有可用的视频源');
        }
        
        // 设置默认参数
        const params = {
            ac: 'detail',
            t: categoryId,
            pg: options.pg || 1,
            ...options
        };
        // 构建缓存键（包含设置信息，确保设置变更时缓存失效）
        const showAdultContent = await settings.getSetting('ui.showAdult', false);
        const cacheKey = generateCacheKey('videos', currentSource.key, params, { 
            includeSettings: true,
            settings: { showAdultContent }
        });
        
        // 尝试从缓存获取
        if (useCache) {
            const cachedData = await cache.get(cacheKey);
            if (cachedData) {
                return cachedData;
            }
        }
        
        // 构建请求URL
        const apiUrl = buildApiUrl(currentSource, params);
        // 发送请求
        let response;
        response = await get(apiUrl, { timeout: 10000 });
        
        // 解析响应数据
        let videoList = { list: [], total: 0, page: params.pg };
        if (currentSource.type === 'json') {
            if (response && response.list) {
                videoList = {
                    list: response.list,
                    total: response.total || response.list.length,
                    page: params.pg
                };
            } else if (Array.isArray(response)) {
                videoList = {
                    list: response,
                    total: response.length,
                    page: params.pg
                };
            }
        } else {
            // XML格式处理（简化）
            if (response && typeof response === 'string') {
                try {
                    const jsonData = JSON.parse(response);
                    videoList = {
                        list: jsonData.list || [],
                        total: jsonData.total || 0,
                        page: params.pg
                    };
                } catch (e) {
                    logger.warn(`解析视频列表失败: ${e.message}`);
                }
            }
        }
        
        // 缓存结果
        if (videoList.list.length > 0) {
            await cache.set(cacheKey, videoList, CACHE_EXPIRE.videoList);
        }
        
        return videoList;
    } catch (error) {
        logger.error(`获取视频列表失败: ${error.message}`);
        return { list: [], total: 0, page: 1 };
    }
}

/**
 * 搜索视频
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 搜索选项
 * @param {number} [options.pg] - 页码，默认为1
 * @param {boolean} [useCache=true] - 是否使用缓存
 * @returns {Promise<Object>} 搜索结果
 */
async function searchVideos(keyword, options = {}, useCache = true) {
    try {
        // 获取当前激活的视频源
        const currentSource = await getCurrentSource();
        if (!currentSource) {
            throw new Error('没有可用的视频源');
        }
        
        if (!currentSource.search) {
            throw new Error('当前视频源不支持搜索功能');
        }
        
        // 设置搜索参数
        const params = {
            ac: 'detail',
            wd: keyword,
            pg: options.pg || 1,
            ...options
        };
        logger.debug(`搜索视频参数: keyword=${keyword}, pg=${params.pg}`);
        
        // 构建缓存键（包含设置信息，确保设置变更时缓存失效）
        const showAdultContent = await settings.getSetting('ui.showAdult', false);
        const searchIdentifier = { keyword, ...params };
        const cacheKey = generateCacheKey('search', currentSource.key, searchIdentifier, { 
            includeSettings: true,
            settings: { showAdultContent }
        });
        
        // 尝试从缓存获取
        if (useCache) {
            const cachedData = await cache.get(cacheKey);
            if (cachedData) {
                return cachedData;
            }
        }
        
        // 构建请求URL
        const apiUrl = buildApiUrl(currentSource, params);
        // 发送请求
        let response;
        if (currentSource.type === 'json') {
            response = await get(apiUrl, { timeout: 10000 });
        } else {
            response = await get(apiUrl, { timeout: 10000 });
        }
        
        // 解析响应数据
        let searchResult = { list: [], total: 0, page: params.pg, keyword };
        if (currentSource.type === 'json') {
            if (response && response.list) {
                searchResult = {
                    list: response.list,
                    total: response.total || response.list.length,
                    page: params.pg,
                    keyword
                };
            } else if (Array.isArray(response)) {
                searchResult = {
                    list: response,
                    total: response.length,
                    page: params.pg,
                    keyword
                };
            }
        } else {
            // XML格式处理（简化）
            if (response && typeof response === 'string') {
                try {
                    const jsonData = JSON.parse(response);
                    searchResult = {
                        list: jsonData.list || [],
                        total: jsonData.total || 0,
                        page: params.pg,
                        keyword
                    };
                } catch (e) {
                    logger.warn(`解析搜索结果失败: ${e.message}`);
                }
            }
        }
        
        // 直接使用原始数据，不进行验证和转换
        logger.debug(`搜索到 ${searchResult.list.length} 条结果`);
        
        // 缓存结果
        if (searchResult.list.length > 0) {
            await cache.set(cacheKey, searchResult, CACHE_EXPIRE.search);
        }
        
        return searchResult;
    } catch (error) {
        logger.error(`搜索视频失败: ${error.message}`);
        return { list: [], total: 0, page: 1, keyword };
    }
}

/**
 * 获取视频详情
 * @param {string|number} videoId - 视频ID
 * @param {boolean} [useCache=true] - 是否使用缓存
 * @returns {Promise<Object>} 视频详情
 */
async function getVideoDetail(videoId, useCache = true) {
    try {
        // 获取当前激活的视频源
        const currentSource = await getCurrentSource();
        if (!currentSource) {
            throw new Error('没有可用的视频源');
        }
        
        // 构建缓存键（包含设置信息，确保设置变更时缓存失效）
        const showAdultContent = await settings.getSetting('ui.showAdult', false);
        const cacheKey = generateCacheKey('detail', currentSource.key, videoId, { 
            includeSettings: true,
            settings: { showAdultContent }
        });
        
        // 尝试从缓存获取
        if (useCache) {
            const cachedData = await cache.get(cacheKey);
            if (cachedData) {
                return cachedData;
            }
        }
        
        // 构建请求参数
        const params = {
            ac: 'detail',
            ids: videoId
        };
        
        // 构建请求URL
        const apiUrl = buildApiUrl(currentSource, params);
        
        // 发送请求
        let response;
        if (currentSource.type === 'json') {
            response = await get(apiUrl, { timeout: 10000 });
        } else {
            response = await get(apiUrl, { timeout: 10000 });
        }
        
        // 解析响应数据
        let videoDetail = null;
        if (currentSource.type === 'json') {
            if (response && response.list && response.list.length > 0) {
                videoDetail = response.list[0];
            } else if (response && typeof response === 'object') {
                // 有些API直接返回详情对象
                videoDetail = response;
            }
        } else {
            // XML格式处理（简化）
            if (response && typeof response === 'string') {
                try {
                    const jsonData = JSON.parse(response);
                    if (jsonData.list && jsonData.list.length > 0) {
                        videoDetail = jsonData.list[0];
                    } else if (typeof jsonData === 'object') {
                        videoDetail = jsonData;
                    }
                } catch (e) {
                    logger.warn(`解析视频详情失败: ${e.message}`);
                }
            }
        }
        
        // 直接使用原始数据，不进行验证和转换
        logger.debug(`获取视频详情成功: ${videoDetail ? videoDetail.vod_name || videoDetail.title : 'null'}`);
        
        // 缓存结果
        if (videoDetail) {
            await cache.set(cacheKey, videoDetail, CACHE_EXPIRE.videoDetail);
        }
        
        return videoDetail;
    } catch (error) {
        logger.error(`获取视频详情失败: ${error.message}`);
        return null;
    }
}

/**
 * 获取最近更新的视频
 * @param {number} [hours=24] - 小时数，默认24小时
 * @param {boolean} [useCache=true] - 是否使用缓存
 * @returns {Promise<Object>} 最近更新的视频列表
 */
async function getRecentVideos(hours = 24, useCache = true) {
    try {
        // 获取当前激活的视频源
        const currentSource = await getCurrentSource();
        if (!currentSource) {
            throw new Error('没有可用的视频源');
        }
        
        // 构建缓存键（包含设置信息，确保设置变更时缓存失效）
        const showAdultContent = await settings.getSetting('ui.showAdult', false);
        const cacheKey = generateCacheKey('recent', currentSource.key, `${hours}h`, { 
            includeSettings: true,
            settings: { showAdultContent }
        });
        
        // 尝试从缓存获取
        if (useCache) {
            const cachedData = await cache.get(cacheKey);
            if (cachedData) {
                return cachedData;
            }
        }
        
        // 构建请求参数
        const params = {
            ac: 'videolist',
            h: hours
        };
        
        // 构建请求URL
        const apiUrl = buildApiUrl(currentSource, params);
        
        // 发送请求
        let response;
        if (currentSource.type === 'json') {
            response = await get(apiUrl, { timeout: 10000 });
        } else {
            response = await get(apiUrl, { timeout: 10000 });
        }
        
        // 解析响应数据
        let recentVideos = { list: [], total: 0, hours };
        if (currentSource.type === 'json') {
            if (response && response.list) {
                recentVideos = {
                    list: response.list,
                    total: response.total || response.list.length,
                    hours
                };
            } else if (Array.isArray(response)) {
                recentVideos = {
                    list: response,
                    total: response.length,
                    hours
                };
            }
        } else {
            // XML格式处理（简化）
            if (response && typeof response === 'string') {
                try {
                    const jsonData = JSON.parse(response);
                    recentVideos = {
                        list: jsonData.list || [],
                        total: jsonData.total || 0,
                        hours
                    };
                } catch (e) {
                    console.warn('解析最近视频失败:', e.message);
                }
            }
        }
        
        // 直接使用原始数据，不进行验证和转换
        console.log(`[videoEngine.js] 获取到 ${recentVideos.list.length} 条最近视频`);
        
        // 缓存结果
        if (recentVideos.list.length > 0) {
            await cache.set(cacheKey, recentVideos, CACHE_EXPIRE.videoList);
        }
        
        return recentVideos;
    } catch (error) {
        console.error('获取最近视频失败:', error.message);
        return { list: [], total: 0, hours };
    }
}

/**
 * 清理视频引擎相关的缓存
 * @param {string} [sourceKey] - 指定源键名，不指定则清理所有
 * @returns {Promise<number>} 清理的缓存数量
 */
async function clearVideoCache(sourceKey = null) {
    try {
        let cleanedCount = 0;
        const stats = await cache.getStats();
        
        const allKeys = await cache.getAllKeys();
        
        for (const key of allKeys) {
            if (key.startsWith('categories_') || 
                key.startsWith('videos_') || 
                key.startsWith('search_') || 
                key.startsWith('detail_') || 
                key.startsWith('recent_') ||
                key.startsWith('getVideos_')) {
                
                if (sourceKey && !key.includes(`_${sourceKey}_`) && !key.includes(`_${sourceKey}$`)) {
                    continue;
                }
                
                await cache.del(key);
                cleanedCount++;
            }
        }
        
        return cleanedCount;
    } catch (error) {
        console.error('清理视频缓存失败:', error.message);
        return 0;
    }
}

module.exports = {
    getCategories,
    getVideos,
    searchVideos,
    getVideoDetail,
    getRecentVideos,
    clearVideoCache
};