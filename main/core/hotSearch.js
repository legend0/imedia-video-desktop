/**
 * 热搜词模块
 * 从豆瓣获取热门电影热搜词，支持24小时缓存
 */
const http = require('../utils/http');
const cache = require('../core/cache');
const logger = require('../utils/log');

const CACHE_KEY = 'video.hotSearch';
const CACHE_EXPIRE = 24 * 60 * 60 * 1000;
const DOUBAN_HOT_URL = 'https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&sort=recommend&page_limit=50&page_start=0';

/**
 * 获取豆瓣热门电影热搜词
 * @returns {Promise<Array<{title: string, rate: string}>>} 热搜词列表
 */
async function fetchHotSearch() {
  try {
    const cached = await cache.get(CACHE_KEY);
    if (cached) {
      logger.debug('从缓存获取热搜词');
      return cached;
    }

    const result = await http.get(DOUBAN_HOT_URL, { simulateHuman: false, enableRetry: true });
    logger.debug(`豆瓣热搜词请求成功，获取 ${result.subjects?.length || 0} 条数据`);
    
    if (!result || !Array.isArray(result.subjects)) {
      logger.warn('豆瓣热搜词返回格式异常');
      return [];
    }

    const hotSearch = result.subjects.map(subject => ({
      title: subject.title,
      rate: subject.rate
    }));

    await cache.set(CACHE_KEY, hotSearch, CACHE_EXPIRE);
    return hotSearch;
  } catch (error) {
    logger.error(`获取热搜词失败: ${error.message}`);
    return [];
  }
}

module.exports = {
  fetchHotSearch
};
