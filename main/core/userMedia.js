/**
 * 收藏和历史播放管理模块
 * 管理用户的收藏视频和播放历史记录
 */
const { read, write, exists, remove } = require('../utils/files');
const { getCurrentSource } = require('./sourceManager');
const log = require('../utils/log');

// 存储键名
const FAVORITES_KEY = 'videoApp.favorites';
const HISTORY_KEY = 'videoApp.history';
const SETTINGS_KEY = 'videoApp.settings';

/**
 * 收藏管理类
 */
class FavoritesManager {
    /**
     * 获取所有收藏
     * @returns {Promise<Array>} 收藏列表
     */
    static async getAll() {
        try {
            const favorites = await read(FAVORITES_KEY, []);
            
            // 验证数据格式
            if (!Array.isArray(favorites)) {
                log.warn('收藏数据格式异常，重置为空数组');
                await write(FAVORITES_KEY, []);
                return [];
            }
            
            return favorites;
        } catch (error) {
            log.error(`获取收藏列表失败: ${error.message}`, error);
            return [];
        }
    }

    /**
     * 根据ID获取收藏项
     * @param {string} videoId - 视频ID
     * @param {string} [sourceKey] - 源键名，不指定则查找所有源
     * @returns {Promise<Object|null>} 收藏项
     */
    static async getById(videoId, sourceKey = null) {
        try {
            const favorites = await this.getAll();
            
            for (const favorite of favorites) {
                if (favorite.videoId === videoId) {
                    if (sourceKey === null || favorite.sourceKey === sourceKey) {
                        return favorite;
                    }
                }
            }
            
            return null;
        } catch (error) {
            log.error(`获取收藏项失败: ${error.message}`, error);
            return null;
        }
    }

    /**
     * 添加收藏
     * @param {Object} videoData - 视频数据
     * @param {string} videoData.videoId - 视频ID
     * @param {string} videoData.title - 视频标题
     * @param {string} videoData.pic - 视频封面
     * @param {string} videoData.url - 视频链接
     * @param {string} [videoData.sourceKey] - 源键名，默认使用当前源
     * @returns {Promise<boolean>} 添加是否成功
     */
    static async add(videoData) {
        try {
            // 获取当前源
            if (!videoData.sourceKey) {
                const currentSource = await getCurrentSource();
                if (!currentSource) {
                    const error = '没有可用的视频源';
                    log.error('添加收藏失败: 没有可用的视频源');
                    throw new Error(error);
                }
                videoData.sourceKey = currentSource.key;
            }
            
            // 直接使用原始数据，不进行验证和转换
            const rawData = videoData;
            
            // 检查是否已收藏
            const videoId = rawData.vod_id || rawData.videoId;
            const sourceKey = rawData.sourceKey || videoData.sourceKey;
            const existing = await this.getById(videoId, sourceKey);
            if (existing) {
                log.debug(`视频已收藏: ${videoId}`);
                return false; // 已收藏
            }
            
            const favorites = await this.getAll();
            
            // 保存完整的视频数据对象，添加收藏相关字段
            const favoriteItem = {
                ...rawData, // 保存所有原始字段
                videoId: videoId,
                sourceKey: sourceKey,
                addedAt: Date.now(),
                tags: Array.isArray(videoData.tags) ? videoData.tags : [],
                favorite: true
            };
            
            favorites.push(favoriteItem);
            const result = await write(FAVORITES_KEY, favorites);
            if (result) {
                log.info(`添加收藏成功: ${favoriteItem.title} (${favoriteItem.videoId})`);
            }
            return result;
        } catch (error) {
            log.error(`添加收藏失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 移除收藏
     * @param {string} videoId - 视频ID
     * @param {string} [sourceKey] - 源键名，不指定则查找所有源
     * @returns {Promise<boolean>} 移除是否成功
     */
    static async remove(videoId, sourceKey = null) {
        try {
            const favorites = await this.getAll();
            const originalLength = favorites.length;
            
            const filteredFavorites = favorites.filter(favorite => {
                if (favorite.videoId === videoId) {
                    if (sourceKey === null || favorite.sourceKey === sourceKey) {
                        return false; // 移除匹配项
                    }
                }
                return true; // 保留其他项
            });
            
            if (filteredFavorites.length === originalLength) {
                return false; // 没有找到匹配项
            }
            
            return await write(FAVORITES_KEY, filteredFavorites);
        } catch (error) {
            log.error(`移除收藏失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 检查是否已收藏
     * @param {string} videoId - 视频ID
     * @param {string} [sourceKey] - 源键名，不指定则查找所有源
     * @returns {Promise<boolean>} 是否已收藏
     */
    static async has(videoId, sourceKey = null) {
        const favorite = await this.getById(videoId, sourceKey);
        return favorite !== null;
    }

    /**
     * 切换收藏状态
     * @param {Object} videoData - 视频数据
     * @returns {Promise<boolean>} 操作是否成功
     */
    static async toggle(videoData) {
        const isFavorited = await this.has(videoData.videoId, videoData.sourceKey);
        
        if (isFavorited) {
            return await this.remove(videoData.videoId, videoData.sourceKey);
        } else {
            return await this.add(videoData);
        }
    }

    /**
     * 按标签获取收藏
     * @param {string} tag - 标签名
     * @returns {Promise<Array>} 匹配的收藏列表
     */
    static async getByTag(tag) {
        try {
            const favorites = await this.getAll();
            return favorites.filter(favorite => 
                favorite.tags && favorite.tags.includes(tag)
            );
        } catch (error) {
            log.error(`按标签获取收藏失败: ${error.message}`, error);
            return [];
        }
    }

    /**
     * 清空收藏
     * @returns {Promise<boolean>} 清空是否成功
     */
    static async clear() {
        try {
            return await write(FAVORITES_KEY, []);
        } catch (error) {
            log.error(`清空收藏失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 获取收藏数量
     * @returns {Promise<number>} 收藏数量
     */
    static async getCount() {
        try {
            const favorites = await this.getAll();
            return favorites.length;
        } catch (error) {
            log.error(`获取收藏数量失败: ${error.message}`, error);
            return 0;
        }
    }
}

/**
 * 播放历史管理类
 */
class HistoryManager {
    /**
     * 获取所有播放历史
     * @param {Object} [options] - 选项对象
     * @param {number} [options.limit] - 限制数量，不指定则获取全部
     * @param {boolean} [options.sourceKey] - 是否只获取当前源的历史记录
     * @returns {Promise<Array>} 播放历史列表
     */
    static async getAll(options = {}) {
        const { limit = null, sourceKey = false } = options;
        
        try {
            let history = await read(HISTORY_KEY, []);
            
            // 验证数据格式
            if (!Array.isArray(history)) {
                log.warn('历史数据格式异常，重置为空数组');
                await write(HISTORY_KEY, []);
                return [];
            }
            
            // 如果启用了源键名存储，且指定sourceKey为true，则只获取当前源的历史记录
            if (sourceKey === true) {
                // 获取当前源
                const settings = await read(SETTINGS_KEY, {});
                const activeSourceId = settings.activeSourceId || 'default';
                // 过滤当前源的历史记录
                history = history.filter(item => item.sourceKey === activeSourceId);
            }
            
            // 按播放时间倒序排序
            history.sort((a, b) => b.playedAt - a.playedAt);
            
            if (limit && limit > 0) {
                return history.slice(0, limit);
            }
            
            return history;
        } catch (error) {
            log.error(`获取播放历史失败: ${error.message}`, error);
            return [];
        }
    }

    /**
     * 根据ID获取历史记录
     * @param {string} videoId - 视频ID
     * @param {string} [sourceKey] - 源键名，不指定则查找所有源
     * @returns {Promise<Object|null>} 历史记录
     */
    static async getById(videoId, sourceKey = null) {
        try {
            const history = await this.getAll();
            
            for (const record of history) {
                if (record.videoId === videoId) {
                    if (sourceKey === null || record.sourceKey === sourceKey) {
                        return record;
                    }
                }
            }
            
            return null;
        } catch (error) {
            log.error(`获取历史记录失败: ${error.message}`, error);
            return null;
        }
    }

    /**
     * 添加播放记录
     * @param {Object} videoData - 视频数据
     * @param {string} videoData.videoId - 视频ID
     * @param {string} videoData.title - 视频标题
     * @param {string} videoData.pic - 视频封面
     * @param {string} videoData.url - 视频链接
     * @param {number} [videoData.progress] - 播放进度（秒）
     * @param {number} [videoData.duration] - 视频总时长（秒）
     * @param {string} [videoData.sourceKey] - 源键名，默认使用当前源
     * @returns {Promise<boolean>} 添加是否成功
     */
    static async add(videoData) {
        try {
            // 获取当前源
            if (!videoData.sourceKey) {
                const currentSource = await getCurrentSource();
                if (!currentSource) {
                    const error = '没有可用的视频源';
                    log.error('添加播放记录失败: 没有可用的视频源');
                    throw new Error(error);
                }
                videoData.sourceKey = currentSource.key;
            }
            
            // 直接使用原始数据，不进行验证和转换
            const rawData = videoData;
            const videoId = rawData.vod_id || rawData.videoId;
            const sourceKey = rawData.sourceKey || videoData.sourceKey;
            
            const history = await this.getAll();
            
            // 检查是否已有记录
            const existingIndex = history.findIndex(record => 
                record.videoId === videoId && 
                record.sourceKey === sourceKey
            );
            
            // 保存完整的视频数据对象，添加历史记录相关字段
            const historyItem = {
                ...rawData, // 保存所有原始字段
                videoId: videoId,
                sourceKey: sourceKey,
                playedAt: Date.now(),
                progress: typeof videoData.progress === 'number' && videoData.progress >= 0 ? videoData.progress : 0,
                duration: typeof videoData.duration === 'number' && videoData.duration >= 0 ? videoData.duration : 0,
                playCount: 1
            };
            
            if (existingIndex !== -1) {
                // 更新现有记录
                const existingRecord = history[existingIndex];
                historyItem.playCount = existingRecord.playCount + 1;
                historyItem.firstPlayedAt = existingRecord.firstPlayedAt || existingRecord.playedAt;

                // 如果新进度大于旧进度，则更新进度
                if (historyItem.progress > existingRecord.progress) {
                    // 使用新进度
                } else {
                    historyItem.progress = existingRecord.progress;
                }

                // 更新时长
                if (historyItem.duration > 0) {
                    // 使用新时长
                } else {
                    historyItem.duration = existingRecord.duration;
                }

                history[existingIndex] = historyItem;
            } else {
                // 添加新记录
                historyItem.firstPlayedAt = Date.now();
                history.push(historyItem);
            }

            // 限制历史记录最多 50 条，超过则按播放时间倒序裁剪掉最旧的记录
            const MAX_HISTORY_COUNT = 50;
            if (history.length > MAX_HISTORY_COUNT) {
                history.sort((a, b) => b.playedAt - a.playedAt);
                const removed = history.splice(MAX_HISTORY_COUNT);
                if (removed.length > 0) {
                    log.info(`历史记录超过 ${MAX_HISTORY_COUNT} 条，已清理 ${removed.length} 条旧记录`);
                }
            }

            const result = await write(HISTORY_KEY, history);
            if (result) {
                log.info(`添加播放记录成功: ${historyItem.title} (${historyItem.videoId})`);
            }
            return result;
        } catch (error) {
            log.error(`添加播放记录失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 更新播放进度
     * @param {string} videoId - 视频ID
     * @param {number} progress - 播放进度（秒）
     * @param {string} [sourceKey] - 源键名，不指定则查找所有源
     * @returns {Promise<boolean>} 更新是否成功
     */
    static async updateProgress(videoId, progress, sourceKey = null) {
        try {
            const record = await this.getById(videoId, sourceKey);
            if (!record) {
                return false;
            }
            
            const history = await this.getAll();
            const index = history.findIndex(item => 
                item.videoId === videoId && 
                (sourceKey === null || item.sourceKey === sourceKey)
            );
            
            if (index !== -1) {
                history[index].progress = progress;
                history[index].playedAt = Date.now();
                return await write(HISTORY_KEY, history);
            }
            
            return false;
        } catch (error) {
            log.error(`更新播放进度失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 移除播放记录
     * @param {string} videoId - 视频ID
     * @param {string} [sourceKey] - 源键名，不指定则查找所有源
     * @returns {Promise<boolean>} 移除是否成功
     */
    static async remove(videoId, sourceKey = null) {
        try {
            const history = await this.getAll();
            const originalLength = history.length;
            
            const filteredHistory = history.filter(record => {
                if (record.videoId === videoId) {
                    if (sourceKey === null || record.sourceKey === sourceKey) {
                        return false; // 移除匹配项
                    }
                }
                return true; // 保留其他项
            });
            
            if (filteredHistory.length === originalLength) {
                return false; // 没有找到匹配项
            }
            
            return await write(HISTORY_KEY, filteredHistory);
        } catch (error) {
            log.error(`移除播放记录失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 清空播放历史
     * @returns {Promise<boolean>} 清空是否成功
     */
    static async clear() {
        try {
            return await write(HISTORY_KEY, []);
        } catch (error) {
            log.error(`清空播放历史失败: ${error.message}`, error);
            return false;
        }
    }

    /**
     * 清理指定天数前的历史记录
     * @param {number} days - 天数
     * @returns {Promise<number>} 清理的记录数量
     */
    static async clearOldRecords(days) {
        try {
            const history = await this.getAll();
            const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
            
            const originalLength = history.length;
            const filteredHistory = history.filter(record => record.playedAt > cutoffTime);
            
            if (filteredHistory.length === originalLength) {
                return 0; // 没有需要清理的记录
            }
            
            await write(HISTORY_KEY, filteredHistory);
            return originalLength - filteredHistory.length;
        } catch (error) {
            log.error(`清理旧历史记录失败: ${error.message}`, error);
            return 0;
        }
    }

    /**
     * 获取最近播放
     * @param {number} [limit=10] - 限制数量
     * @returns {Promise<Array>} 最近播放列表
     */
    static async getRecent(limit = 10) {
        return await this.getAll(limit);
    }

    /**
     * 获取播放次数最多的视频
     * @param {number} [limit=10] - 限制数量
     * @returns {Promise<Array>} 热门播放列表
     */
    static async getMostPlayed(limit = 10) {
        try {
            const history = await this.getAll();
            
            // 按播放次数倒序排序
            history.sort((a, b) => b.playCount - a.playCount);
            
            return history.slice(0, limit);
        } catch (error) {
            log.error(`获取热门播放失败: ${error.message}`, error);
            return [];
        }
    }

    /**
     * 获取播放历史数量
     * @returns {Promise<number>} 历史记录数量
     */
    static async getCount() {
        try {
            const history = await this.getAll();
            return history.length;
        } catch (error) {
            log.error(`获取历史记录数量失败: ${error.message}`, error);
            return 0;
        }
    }
}

module.exports = {
    FavoritesManager,
    HistoryManager
};