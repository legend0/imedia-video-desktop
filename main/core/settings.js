/**
 * 项目设置管理模块
 * 支持项目配置的创建、修改和子项设置
 */
const { read, write, exists } = require('../utils/files');
const EventEmitter = require('events');
const { DOWNLOAD_DIR } = require('../utils/files');
const logger = require('../utils/log');

const STORAGE_KEY = 'videoApp.settings';

const settingsEmitter = new EventEmitter();

const DEFAULT_SETTINGS = {
  "app": {
    "name": "影视岛",
    "version": "1.0.0",
    "language": "zh-CN",
    "startupBehavior": "disabled",
    "closeBehavior": "ask",
    "download": DOWNLOAD_DIR,
    "autoUpdate": true,
    "downloadMethod": "ffmpeg"
  },
  "player": {
    "autoplay": false,
    "autoNext": true,
    "volume": 59,
    "volumeStep": 10,
    "quality": "auto",
    "speed": 1,
    "skipStep": 10,
    "autoFullscreen": true,
    "showControls": true,
    "controlsHideDelay": 3000,
    "skipIntroTime": 0,
    "skipOutroTime": 0,
    "enableShortcuts": true,
    "hlsEnableWorker": true,
    "hlsEnableSoftwareAES": true,
    "hlsMaxBufferSize": 50,
    "hlsMaxBufferLength": 30
  },
  "ui": {
    "theme": "system",
    "pageSize": 20,
    "showAdult": false,
    "homeCategoryCount": 8
  },
  "download": {
    "maxConcurrentTasks": 0,
    "maxConcurrentSegments": 0
  },
  "source": {
    "autoSubscribe": false,
    "lastSubscribeDate": "",
    "autoCheck": false,
    "autoCheckIntervalHours": 6
  },
  "cache": {
    "enabled": true,
    "expireTime": 86400000,
    "maxSize": 104857600
  },
  "network": {
    "timeout": 10000,
    "retryCount": 3,
    "retryDelay": 1000,
    "userAgent": "",
    "proxy": {
      "enabled": false,
      "host": "",
      "port": 0,
      "username": "",
      "password": ""
    }
  },
  "mediaInfo": {
    "tmdbKey": ""
  },
  "backup": {
    "webdav": {
      "enabled": false,
      "url": "",
      "username": "",
      "password": "",
      "basePath": "/videoApp-backups/"
    }
  },
  "iptv": {
    "subscriptionUrl": "",
    "autoSubscribe": false,
    "lastSubscribeDate": ""
  }
};

/**
 * 初始化设置
 * @returns {Promise<Object>} 设置对象
 */
async function initSettings() {
    const settingsExist = await exists(STORAGE_KEY);
    if (!settingsExist) {
        await write(STORAGE_KEY, DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
    
    // 读取现有设置，并合并默认设置中缺失的项
    const existingSettings = await read(STORAGE_KEY, {});
    const mergedSettings = mergeDeep(DEFAULT_SETTINGS, existingSettings);
    
    // 如果有新增的默认设置，更新存储
    if (JSON.stringify(existingSettings) !== JSON.stringify(mergedSettings)) {
        await write(STORAGE_KEY, mergedSettings);
    }
    
    return mergedSettings;
}

/**
 * 深度合并对象
 * @param {Object} target - 目标对象
 * @param {Object} source - 源对象
 * @returns {Object} 合并后的对象
 */
function mergeDeep(target, source) {
    const result = { ...target };
    
    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = mergeDeep(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }
    
    return result;
}

/**
 * 获取所有设置
 * @returns {Promise<Object>} 所有设置对象
 */
async function getAllSettings() {
    try {
        return await initSettings();
    } catch (error) {
        logger.error(`获取设置失败: ${error.message}`);
        return {};
    }
}

/**
 * 获取指定设置项
 * @param {string} key - 设置键名，支持点号分隔的子项，如 'player.autoplay'
 * @param {*} [defaultValue] - 默认值，当设置不存在时返回
 * @returns {Promise<*>} 设置值或默认值
 */
async function getSetting(key, defaultValue = undefined) {
    try {
        const settings = await getAllSettings();
        
        if (!key) {
            return settings;
        }
        
        // 支持点号分隔的子项访问
        const keys = key.split('.');
        let value = settings;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        
        return value;
    } catch (error) {
        logger.error(`获取设置失败: ${error.message}`);
        return defaultValue;
    }
}

/**
 * 设置指定项
 * @param {string} key - 设置键名，支持点号分隔的子项，如 'player.autoplay'
 * @param {*} value - 设置值
 * @returns {Promise<boolean>} 设置是否成功
 */
async function setSetting(key, value) {
    try {
        if (!key) {
            throw new Error('设置键名不能为空');
        }

        // 值类型校验：拒绝 undefined/function 等无法序列化的无效值
        if (value === undefined || typeof value === 'function') {
            throw new Error('设置值类型无效');
        }

        const settings = await getAllSettings();
        
        // 获取旧值用于事件比较
        const oldValue = await getSetting(key);
        
        // 支持点号分隔的子项设置
        const keys = key.split('.');
        let current = settings;
        
        // 导航到目标位置
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k] || typeof current[k] !== 'object') {
                current[k] = {};
            }
            current = current[k];
        }
        
        // 设置值
        const lastKey = keys[keys.length - 1];
        current[lastKey] = value;
        
        // 保存设置
        const success = await write(STORAGE_KEY, settings);
        
        // 如果保存成功且值发生变化，发射事件
        if (success && JSON.stringify(oldValue) !== JSON.stringify(value)) {
            settingsEmitter.emit('settingsChanged', { key, value, oldValue });
        }
        
        return success;
    } catch (error) {
        logger.error(`设置失败: ${error.message}`);
        return false;
    }
}

/**
 * 批量设置
 * @param {Object} settings - 要设置的对象
 * @returns {Promise<boolean>} 设置是否成功
 */
async function setSettings(settings) {
    try {
        if (!settings || typeof settings !== 'object') {
            throw new Error('设置必须是一个对象');
        }
        
        const currentSettings = await getAllSettings();
        
        // 处理带点号的键名，将其转换为嵌套对象
        const processedSettings = {};
        
        for (const key in settings) {
            if (settings.hasOwnProperty(key)) {
                // 如果键名包含点号，则按点号分割并创建嵌套对象
                if (key.includes('.')) {
                    const keys = key.split('.');
                    let current = processedSettings;
                    
                    // 导航到目标位置
                    for (let i = 0; i < keys.length - 1; i++) {
                        const k = keys[i];
                        if (!current[k] || typeof current[k] !== 'object') {
                            current[k] = {};
                        }
                        current = current[k];
                    }
                    
                    // 设置值
                    const lastKey = keys[keys.length - 1];
                    current[lastKey] = settings[key];
                } else {
                    // 不包含点号的键名直接设置
                    processedSettings[key] = settings[key];
                }
            }
        }
        
        // 合并当前设置和处理后的设置
        const newSettings = mergeDeep(currentSettings, processedSettings);
        
        return await write(STORAGE_KEY, newSettings);
    } catch (error) {
        logger.error(`批量设置失败: ${error.message}`);
        return false;
    }
}

/**
 * 重置指定设置项为默认值
 * @param {string} key - 设置键名，支持点号分隔的子项
 * @returns {Promise<boolean>} 重置是否成功
 */
async function resetSetting(key) {
    try {
        if (!key) {
            throw new Error('设置键名不能为空');
        }
        
        // 获取默认值
        const defaultValue = getDefaultValue(DEFAULT_SETTINGS, key);
        if (defaultValue === undefined) {
            throw new Error(`未找到设置项 ${key} 的默认值`);
        }
        
        return await setSetting(key, defaultValue);
    } catch (error) {
        logger.error(`重置设置失败: ${error.message}`);
        return false;
    }
}

/**
 * 重置所有设置为默认值
 * @returns {Promise<boolean>} 重置是否成功
 */
async function resetAllSettings() {
    try {
        return await write(STORAGE_KEY, DEFAULT_SETTINGS);
    } catch (error) {
        logger.error(`重置所有设置失败: ${error.message}`);
        return false;
    }
}

/**
 * 从默认设置中获取指定键的值
 * @param {Object} defaults - 默认设置对象
 * @param {string} key - 设置键名，支持点号分隔的子项
 * @returns {*} 默认值
 */
function getDefaultValue(defaults, key) {
    const keys = key.split('.');
    let value = defaults;
    
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return undefined;
        }
    }
    
    return value;
}

/**
 * 删除指定设置项
 * @param {string} key - 设置键名，支持点号分隔的子项
 * @returns {Promise<boolean>} 删除是否成功
 */
async function deleteSetting(key) {
    try {
        if (!key) {
            throw new Error('设置键名不能为空');
        }
        
        const settings = await getAllSettings();
        const keys = key.split('.');
        
        // 导航到目标位置的父级
        let current = settings;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k] || typeof current[k] !== 'object') {
                return true; // 不存在则认为删除成功
            }
            current = current[k];
        }
        
        // 删除键
        const lastKey = keys[keys.length - 1];
        if (current && typeof current === 'object' && lastKey in current) {
            delete current[lastKey];
            return await write(STORAGE_KEY, settings);
        }
        
        return true; // 不存在则认为删除成功
    } catch (error) {
        logger.error(`删除设置失败: ${error.message}`);
        return false;
    }
}

/**
 * 检查设置项是否存在
 * @param {string} key - 设置键名，支持点号分隔的子项
 * @returns {Promise<boolean>} 是否存在
 */
async function hasSetting(key) {
    try {
        if (!key) {
            return false;
        }
        
        const settings = await getAllSettings();
        const keys = key.split('.');
        let current = settings;
        
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                return false;
            }
        }
        
        return true;
    } catch (error) {
        logger.error(`检查设置存在性失败: ${error.message}`);
        return false;
    }
}

/**
 * 获取设置项的路径列表
 * @param {string} [parentKey=''] - 父级键名
 * @returns {Promise<Array<string>>} 设置项路径列表
 */
async function getSettingPaths(parentKey = '') {
    try {
        const settings = await getAllSettings();
        const paths = [];
        
        function collectPaths(obj, prefix = '') {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const fullPath = prefix ? `${prefix}.${key}` : key;
                    paths.push(fullPath);
                    
                    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                        collectPaths(obj[key], fullPath);
                    }
                }
            }
        }
        
        if (parentKey) {
            const parentValue = getSetting(parentKey);
            if (parentValue && typeof parentValue === 'object') {
                collectPaths(parentValue, parentKey);
            }
        } else {
            collectPaths(settings);
        }
        
        return paths;
    } catch (error) {
        logger.error(`获取设置路径失败: ${error.message}`);
        return [];
    }
}

module.exports = {
    getAllSettings,
    getSetting,
    setSetting,
    setSettings,
    resetSetting,
    resetAllSettings,
    deleteSetting,
    hasSetting,
    getSettingPaths,
    on: settingsEmitter.on.bind(settingsEmitter),
    off: settingsEmitter.off.bind(settingsEmitter),
    once: settingsEmitter.once.bind(settingsEmitter),
    emit: settingsEmitter.emit.bind(settingsEmitter)
};