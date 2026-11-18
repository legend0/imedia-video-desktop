/**
 * 视频源管理器
 * 提供视频源的增删改查、切换和测试功能
 */
const { read, write, exists } = require('../utils/files');
const { get } = require('../utils/http');
const logger = require('../utils/log');
const settings = require('./settings');

const STORAGE_KEY = 'videoApp.sources';
const SETTINGS_KEY = 'videoApp.settings';
const DEFAULT_SOURCES = {
    "default": {
        "enable": true,
        "name": "默认源",
        "url": "https://sdzyapi.com",
        "path": "/api.php/provide/vod/",
        "type": "json",
        "isActive": true,
        "search": false,
        "isAdult": false,
        "test": {
            "success": true,
            "responseTime": 413,
            "status": 200,
            "timestamp": Date.now()
        }
    }
};

/**
 * 初始化视频源配置
 */
async function initSources() {
    const sourcesExist = await exists(STORAGE_KEY);
    if (!sourcesExist) {
        await write(STORAGE_KEY, DEFAULT_SOURCES);
        return DEFAULT_SOURCES;
    }
    return await read(STORAGE_KEY, DEFAULT_SOURCES);
}

/**
 * 获取所有视频源列表
 * @returns {Promise<Object>} 所有视频源对象
 */
async function getSourceList() {
    try {
        return await initSources();
    } catch (error) {
        logger.error(`获取视频源列表失败: ${error.message}`);
        return {};
    }
}

/**
 * 获取当前激活的视频源
 * @returns {Promise<Object|null>} 当前激活的视频源对象
 */
async function getCurrentSource() {
    try {
        const sources = await getSourceList();
        for (const [key, source] of Object.entries(sources)) {
            if (source.isActive) {
                return { key, ...source };
            }
        }
        return null;
    } catch (error) {
        logger.error(`获取当前视频源失败: ${error.message}`);
        return null;
    }
}

/**
 * 切换到指定的视频源
 * @param {string} sourceKey - 要切换的视频源键名
 * @returns {Promise<boolean>} 切换是否成功（同源时返回 true 但不执行写入）
 */
async function switchSource(sourceKey) {
    try {
        const sources = await getSourceList();

        if (!sources[sourceKey]) {
            throw new Error(`视频源 ${sourceKey} 不存在`);
        }

        if (!sources[sourceKey].enable) {
            throw new Error(`视频源 ${sourceKey} 已禁用`);
        }

        // 同源不处理：避免无意义的写入和触发 source:changed 事件
        if (sources[sourceKey].isActive) {
            return true;
        }

        // 将所有源设置为非激活状态
        for (const key in sources) {
            sources[key].isActive = false;
        }

        // 设置指定源为激活状态
        sources[sourceKey].isActive = true;
        // 更新设置中的当前源
        const settings = await read(SETTINGS_KEY, {});
        settings.activeSourceId = sourceKey;
        await write(SETTINGS_KEY, settings);

        await write(STORAGE_KEY, sources);
        return true;
    } catch (error) {
        logger.error(`切换视频源失败: ${error.message}`);
        return false;
    }
}

/**
 * 添加新的视频源
 * @param {string} key - 视频源键名
 * @param {Object} sourceData - 视频源数据
 * @returns {Promise<boolean>} 添加是否成功
 */
async function addSource(key, sourceData) {
    try {
        const sources = await getSourceList();
        
        if (sources[key]) {
            throw new Error(`视频源 ${key} 已存在`);
        }
        
        // 验证必要字段
        const requiredFields = ['name', 'url', 'path', 'type'];
        for (const field of requiredFields) {
            if (!sourceData[field]) {
                throw new Error(`缺少必要字段: ${field}`);
            }
        }
        
        // 设置默认值
        const newSource = {
            enable: true,
            name: sourceData.name,
            url: sourceData.url,
            path: sourceData.path,
            type: sourceData.type,
            isActive: false,
            search: sourceData.search !== undefined ? sourceData.search : true,
            isAdult: sourceData.isAdult !== undefined ? sourceData.isAdult : false,
            test: {
                success: false,
                responseTime: 0,
                status: 0,
                timestamp: Date.now()
            }
        };
        
        sources[key] = newSource;
        await write(STORAGE_KEY, sources);
        return true;
    } catch (error) {
        logger.error(`添加视频源失败: ${error.message}`);
        return false;
    }
}

/**
 * 删除指定的视频源
 * @param {string} sourceKey - 要删除的视频源键名
 * @returns {Promise<boolean>} 删除是否成功
 */
async function removeSource(sourceKey) {
    try {
        const sources = await getSourceList();
        
        if (!sources[sourceKey]) {
            throw new Error(`视频源 ${sourceKey} 不存在`);
        }
        
        if (sources[sourceKey].isActive) {
            throw new Error(`不能删除当前激活的视频源 ${sourceKey}`);
        }
        
        delete sources[sourceKey];
        await write(STORAGE_KEY, sources);
        return true;
    } catch (error) {
        logger.error(`删除视频源失败: ${error.message}`);
        return false;
    }
}

/**
 * 修改指定的视频源
 * @param {string} sourceKey - 要修改的视频源键名
 * @param {Object} updateData - 更新的数据
 * @returns {Promise<boolean>} 修改是否成功
 */
async function updateSource(sourceKey, updateData) {
    try {
        const sources = await getSourceList();
        
        if (!sources[sourceKey]) {
            throw new Error(`视频源 ${sourceKey} 不存在`);
        }
        
        // 更新源数据，保留原有测试记录（除非明确更新）
        const originalSource = sources[sourceKey];
        const updatedSource = {
            ...originalSource,
            ...updateData
        };
        
        // 如果更新了测试信息，更新时间戳
        if (updateData.test) {
            updatedSource.test.timestamp = Date.now();
        }
        
        sources[sourceKey] = updatedSource;
        await write(STORAGE_KEY, sources);
        return true;
    } catch (error) {
        logger.error(`修改视频源失败: ${error.message}`);
        return false;
    }
}

/**
 * 测试视频源的连通性和响应性能
 * @param {string|Object} sourceKeyOrObject - 要测试的视频源键名或源对象
 * @returns {Promise<Object>} 测试结果
 * 
 * 注意：此函数可以接受两种类型的参数：
 * 1. 源键名字符串：直接使用键名查找源
 * 2. 源对象：通过源对象的name属性匹配对应的源
 */
async function testSource(sourceKeyOrObject) {
    try {
        const sources = await getSourceList();
        
        let sourceKey = null;
        let source = null;
                
        // 判断传入的是源对象还是源键名
        if (typeof sourceKeyOrObject === 'object' && sourceKeyOrObject !== null) {
            // 传入的是源对象，需要找到对应的键名
            source = sourceKeyOrObject;
            for (const [key, value] of Object.entries(sources)) {
                if (value.name === source.name) {
                    sourceKey = key;
                    break;
                }
            }
            
            if (!sourceKey) {
                throw new Error(`未找到名为 "${source.name}" 的视频源`);
            }
            
        } else {
            // 传入的是源键名
            sourceKey = sourceKeyOrObject;
            if (!sources[sourceKey]) {
                throw new Error(`视频源 ${sourceKey} 不存在`);
            }
            source = sources[sourceKey];
        }
        const testUrl = source.url + source.path+'?ac=detail&wd=测试';
        
        const startTime = Date.now();
        let testResult = {
            success: false,
            responseTime: 0,
            status: 0,
            timestamp: Date.now(),
            error: null
        };
        
        try {
            const response = await get(testUrl, { timeout: 10000, fullResponse: true });
            testResult.success = true;
            testResult.status = response.status || 200;
            testResult.responseTime = Date.now() - startTime;
            
            // 检查返回内容是否为有效的JSON或XML格式
            if (response && response.data) {
                const contentType = response.headers && response.headers['content-type'] ? 
                response.headers['content-type'].toLowerCase() : '';
               
                // 检查内容类型
                const isJsonContent = contentType.includes('application/json') || 
                                     contentType.includes('text/json');
                const isXmlContent = contentType.includes('application/xml') || 
                                    contentType.includes('text/xml');
                
                // 如果内容类型不明确，检查实际内容
                let isValidFormat = isJsonContent || isXmlContent;
                
                // 如果内容类型不明确，尝试从实际数据判断
                if (!isValidFormat) {
                    // 尝试解析为JSON
                    try {
                        // 如果是对象，直接判断为有效JSON
                        if (typeof response.data === 'object') {
                            isValidFormat = true;
                        } 
                        // 如果是字符串，尝试解析
                        else if (typeof response.data === 'string') {
                            JSON.parse(response.data);
                            isValidFormat = true;
                        }
                    } catch (e) {
                        
                        // 尝试解析为XML
                        try {
                            // 简单检查是否包含XML标签
                            if (typeof response.data === 'string' &&
                                response.data.trim().startsWith('<') && 
                                response.data.trim().endsWith('>')) {
                                isValidFormat = true;
                            }
                        } catch (e2) {
                            logger.error(`XML解析失败: ${e2.message}`);
                            isValidFormat = false;
                        }
                    }
                }
                
                logger.debug(`格式有效性: ${isValidFormat}, search=${sources[sourceKey].search}`);
                
                // 根据格式有效性更新搜索功能状态
                if (isValidFormat) {
                    sources[sourceKey].search = true;
                } else {
                    sources[sourceKey].search = false;
                }
            }
        } catch (error) {
            testResult.error = error.message;
            testResult.responseTime = Date.now() - startTime;
            
            // 由于get函数已经抛出错误，我们需要从错误对象中获取状态码
            if (error.response) {
                testResult.status = error.response.status;
            }
        }
        
        // 更新源的测试信息
        sources[sourceKey].test = testResult;
        
        // 创建包含search字段的返回结果
        const resultWithSearch = {
            ...testResult,
            search: sources[sourceKey].search
        };
        
        await write(STORAGE_KEY, sources);
        
        return resultWithSearch;
    } catch (error) {
        logger.error(`测试视频源失败: ${error.message}`);
        return {
            success: false,
            responseTime: 0,
            status: 0,
            timestamp: Date.now(),
            error: error.message
        };
    }
}

/**
 * 测试所有视频源
 * @returns {Promise<Object>} 所有源的测试结果
 */
async function testAllSources() {
    try {
        const sources = await getSourceList();
        const results = {};
        
        for (const key of Object.keys(sources)) {
            results[key] = await testSource(key);
        }
        
        return results;
    } catch (error) {
        console.error('测试所有视频源失败:', error.message);
        return {};
    }
}

/**
 * 尝试 base64 解码，失败则返回原文
 */
function tryDecodeBase64(str) {
    if (!str) return '';
    try {
        const decoded = Buffer.from(str.trim(), 'base64').toString('utf-8');
        if (decoded && /[\u4e00-\u9fff\w\s.,;:!?()【】\-]/.test(decoded)) {
            return decoded;
        }
        return str;
    } catch {
        return str;
    }
}

/**
 * 解析订阅地址，返回标准源数据数组
 * @param {string} url - 订阅地址
 * @returns {Promise<Object[]>} 解析后的源数据数组
 */
async function parseSubscription(url) {
    try {
        const response = await get(url, { timeout: 15000 });
        const data = response;
        const sources = [];

        let showAdult = false;
        try {
            showAdult = await settings.getSetting('ui.showAdult', false);
        } catch {
            showAdult = false;
        }

        const makeSource = (name, url, isAdult, description) => ({
            name: name.replace(/[\r\n]/g, '').trim(),
            url,
            path: '/api.php/provide/vod/',
            type: 'json',
            isAdult,
            enable: true,
            isActive: false,
            search: false,
            description: description ? tryDecodeBase64(description) : '',
            test: { success: false, responseTime: 0, status: 0, timestamp: Date.now() },
        });

        const allSites = data.all_sites;
        if (Array.isArray(allSites)) {
            const list = allSites
                .map((site) => {
                    const s = site;
                    if (s.source === 'adult' && !showAdult) return null;
                    return makeSource(
                        s.name || '',
                        s.url || '',
                        s.source === 'adult',
                        s.description || ''
                    );
                })
                .filter((s) => s !== null && !!s.name && !!s.url);
            sources.push(...list);
        } else {
            const media = data.media;
            if (Array.isArray(media)) {
                const list = media
                    .map((site) => {
                        const s = site;
                        return makeSource(
                            s.name || '',
                            s.api_domain || '',
                            false,
                            s.description || ''
                        );
                    })
                    .filter((s) => !!s.name && !!s.url);
                sources.push(...list);
            }
            const adult = data.adult;
            if (Array.isArray(adult) && showAdult) {
                const list = adult
                    .map((site) => {
                        const s = site;
                        return makeSource(
                            s.name || '',
                            s.api_domain || '',
                            true,
                            s.description || ''
                        );
                    })
                    .filter((s) => !!s.name && !!s.url);
                sources.push(...list);
            }
        }

        if (sources.length === 0) {
            throw new Error('订阅数据格式错误：未找到有效的媒体源');
        }
        return sources;
    } catch (error) {
        logger.error(`解析订阅失败: ${error.message}`);
        throw error;
    }
}

/**
 * 批量订阅源，返回 {added, skipped, failed}
 * @param {string} url - 订阅地址
 * @returns {Promise<Object>} 订阅结果
 */
async function subscribeSources(url) {
    try {
        const parsedSources = await parseSubscription(url);
        const sources = await getSourceList();
        
        const result = { added: 0, skipped: 0, failed: 0 };
        for (const source of parsedSources) {
            const name = source.name;
            const sourceUrl = source.url;
            
            const exists = Object.values(sources).some(
                (s) => s.url === sourceUrl || s.name === name
            );
            if (exists) {
                result.skipped++;
                continue;
            }
            
            try {
                const newId = 'source_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                await addSource(newId, source);
                result.added++;
            } catch {
                result.failed++;
            }
        }
        
        return { success: true, data: result };
    } catch (error) {
        logger.error(`订阅源失败: ${error.message}`);
        return { success: false, error: error.message };
    }
}

module.exports = {
    getSourceList,
    getCurrentSource,
    switchSource,
    addSource,
    removeSource,
    updateSource,
    testSource,
    testAllSources,
    parseSubscription,
    subscribeSources
};