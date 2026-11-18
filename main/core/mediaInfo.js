/**
 * 媒体信息模块
 * 整合 TMDB API 和网页爬取，提供影视补充信息查询
 * API Key 从用户设置读取（mediaInfo.tmdbKey），未配置则直接返回空结果
 * @module mediaInfo
 */
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/log');
const settings = require('./settings');

const TMDB_BASE_URL = 'https://api.tmdb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TMDB_WEB_BASE = 'https://www.themoviedb.org';
const TMDB_LANGUAGE = 'zh-CN';

/**
 * 从设置中读取 TMDB API Key
 * @returns {Promise<string>} API Key（未配置则返回空字符串）
 */
async function getTmdbApiKey() {
    try {
        return (await settings.getSetting('mediaInfo.tmdbKey', '')) || '';
    } catch (error) {
        logger.warn(`读取 TMDB API Key 失败: ${error.message}`);
        return '';
    }
}

/**
 * 调用 TMDB API
 * @param {string} endpoint - API 端点
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} API 响应数据
 */
async function callTMDBAPI(endpoint, params = {}) {
    const apiKey = await getTmdbApiKey();
    if (!apiKey) {
        throw new Error('未配置 TMDB API Key');
    }

    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.append('api_key', apiKey);
    url.searchParams.append('language', TMDB_LANGUAGE);

    Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
            url.searchParams.append(key, params[key]);
        }
    });

    const response = await axios.get(url.toString(), { timeout: 10000 });

    if (response.status !== 200) {
        throw new Error(`TMDB API 调用失败: ${response.status}`);
    }

    return response.data;
}

/**
 * 搜索影视作品，返回合并排序后的结果
 * @param {string} query - 搜索关键词
 * @returns {Promise<Array>} 搜索结果列表
 */
async function searchMedia(query) {
    const [movieResults, tvResults] = await Promise.all([
        callTMDBAPI('/search/movie', { query }),
        callTMDBAPI('/search/tv', { query })
    ]);

    const movies = (movieResults.results || []).map(item => ({
        ...item,
        media_type: 'movie'
    }));

    const tvShows = (tvResults.results || []).map(item => ({
        ...item,
        media_type: 'tv',
        title: item.name,
        release_date: item.first_air_date
    }));

    const allResults = [...movies, ...tvShows];
    allResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    return allResults;
}

/**
 * 获取影视详情（含演职员）
 * @param {number} mediaId - TMDB 影视 ID
 * @param {string} mediaType - 媒体类型 ('movie' 或 'tv')
 * @returns {Promise<Object>} 详情数据
 */
async function getMediaDetails(mediaId, mediaType) {
    return await callTMDBAPI(`/${mediaType}/${mediaId}`, {
        append_to_response: 'credits,reviews'
    });
}

/**
 * 将 TMDB 数据转换为标准 MediaInfo 格式
 * @param {Object} tmdbData - TMDB 返回的数据
 * @param {string} mediaType - 媒体类型 ('movie' 或 'tv')
 * @returns {Object} 标准化的影视信息
 */
function convertToMediaInfo(tmdbData, mediaType) {
    const isMovie = mediaType === 'movie';

    const directors = (tmdbData.credits?.crew || [])
        .filter(person => person.job === 'Director')
        .map(person => person.name);

    const castData = (tmdbData.credits?.cast || []).slice(0, 10);
    const actorDetails = castData.map(person => ({
        name: person.name,
        character: person.character || '',
        avatar: person.profile_path
            ? `${TMDB_IMAGE_BASE}/w185${person.profile_path}`
            : null
    }));

    const genres = (tmdbData.genres || []).map(genre => genre.name);

    const productionCountries = (tmdbData.production_countries || [])
        .map(country => country.name)
        .join(', ') || '';

    const spokenLanguages = (tmdbData.spoken_languages || [])
        .map(lang => lang.name)
        .join(', ') || '';

    const releaseDate = isMovie
        ? tmdbData.release_date
        : tmdbData.first_air_date;

    const year = releaseDate ? releaseDate.split('-')[0] : '';

    const duration = isMovie
        ? (tmdbData.runtime ? `${tmdbData.runtime}分钟` : '')
        : (tmdbData.number_of_episodes
            ? `共${tmdbData.number_of_episodes}集`
            : '');

    const status = isMovie
        ? (tmdbData.status === 'Released' ? '已上映' : tmdbData.status || '')
        : (tmdbData.status === 'Ended'
            ? '已完结'
            : tmdbData.status === 'Returning Series'
                ? '连载中'
                : tmdbData.status || '');

    const reviews = (tmdbData.reviews?.results || []).slice(0, 5).map(review => ({
        reviewer: review.author || '匿名用户',
        avatar: review.author_details?.avatar_path
            ? `${TMDB_IMAGE_BASE}/w45${review.author_details.avatar_path}`
            : '',
        content: review.content || '',
        rating: review.author_details?.rating || null,
        date: review.created_at ? review.created_at.split('T')[0] : '',
        url: review.url || ''
    }));

    return {
        name: tmdbData.title || tmdbData.name || '',
        originalName: tmdbData.original_title || tmdbData.original_name || '',
        director: directors.length > 0 ? directors.join(' / ') : '',
        actorDetails: actorDetails,
        type: isMovie ? '电影' : '电视剧',
        genres: genres,
        region: productionCountries,
        year: year,
        releaseDate: releaseDate || '',
        duration: duration,
        episodes: isMovie ? 1 : (tmdbData.number_of_episodes || 0),
        synopsis: tmdbData.overview || '',
        rating: tmdbData.vote_average || 0,
        language: spokenLanguages,
        status: status,
        poster: tmdbData.poster_path
            ? `${TMDB_IMAGE_BASE}/w500${tmdbData.poster_path}`
            : '',
        backdrop: tmdbData.backdrop_path
            ? `${TMDB_IMAGE_BASE}/w1280${tmdbData.backdrop_path}`
            : '',
        reviews: reviews
    };
}

/**
 * 爬取 TMDB 网页获取剧照
 * @param {string} movieName - 影视名称
 * @param {string} mediaType - 媒体类型 ('movie' 或 'tv')
 * @returns {Promise<Array>} 剧照列表
 */
async function fetchPhotosFromWeb(movieName, mediaType) {
    try {
        const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            }
        });

        const searchUrl = `${TMDB_WEB_BASE}/search?query=${encodeURIComponent(movieName)}`;
        const searchResponse = await axiosInstance.get(searchUrl);
        const $ = cheerio.load(searchResponse.data);

        let detailPath = $('.card .result').first().attr('href')
            || $('a[href*="/movie/"]').first().attr('href')
            || $('a[href*="/tv/"]').first().attr('href');

        if (!detailPath) {
            return [];
        }

        const mediaSection = mediaType === 'tv' ? 'tv' : 'movie';
        if (!detailPath.includes(`/${mediaSection}/`)) {
            const links = $(`a[href*="/${mediaSection}/"]`);
            if (links.length > 0) {
                detailPath = links.first().attr('href');
            }
        }

        const detailUrl = `${TMDB_WEB_BASE}${detailPath}`;
        const detailResponse = await axiosInstance.get(detailUrl);
        const $$ = cheerio.load(detailResponse.data);

        const photos = [];
        $$('#media_scroller .backdrop img.backdrop').each((index, element) => {
            let photoUrl = $$(element).attr('data-src') || $$(element).attr('src') || '';
            if (photoUrl) {
                photoUrl = photoUrl.split(' ')[0];
                if (photoUrl.startsWith('/')) {
                    photoUrl = `${TMDB_WEB_BASE}${photoUrl}`;
                }
                photos.push({
                    url: photoUrl,
                    alt: $$(element).attr('alt') || `剧照 ${index + 1}`
                });
            }
        });

        return photos;
    } catch (error) {
        logger.warn(`爬取剧照失败: ${error.message}`);
        return [];
    }
}

/**
 * 查询影视补充信息（主入口）
 * 整合 TMDB API 数据和网页爬取的剧照
 * @param {string} movieName - 影视名称
 * @param {Object} options - 查询选项
 * @param {string} [options.year] - 年份，用于精确匹配
 * @param {boolean} [options.isTv] - 是否为电视剧
 * @param {boolean} [options.includePhotos] - 是否包含网页爬取的剧照（默认 true）
 * @returns {Promise<Object>} 查询结果 { success, data, error }
 */
async function queryMediaInfo(movieName, options = {}) {
    try {
        if (!movieName || typeof movieName !== 'string') {
            return { success: false, data: null, error: '查询关键词不能为空' };
        }

        // 未配置 TMDB API Key 时直接返回空，不启用信息补充
        const apiKey = await getTmdbApiKey();
        if (!apiKey) {
            logger.debug('未配置 TMDB API Key，跳过信息补充查询');
            return { success: false, data: null, error: '未配置 TMDB API Key，请在设置中填写后启用信息补充' };
        }

        const { year, isTv = false, includePhotos = true } = options;
        const searchQuery = year ? `${movieName} ${year}` : movieName;

        let searchResults;
        if (isTv) {
            const tvResults = await callTMDBAPI('/search/tv', { query: searchQuery.trim() });
            searchResults = (tvResults.results || []).map(item => ({
                ...item,
                media_type: 'tv',
                title: item.name,
                release_date: item.first_air_date
            }));
        } else {
            searchResults = await searchMedia(searchQuery.trim());
        }

        if (!searchResults || searchResults.length === 0) {
            return { success: false, data: null, error: '未找到相关影视作品' };
        }

        const firstResult = searchResults[0];
        const resultMediaType = firstResult.media_type;
        const mediaId = firstResult.id;

        const details = await getMediaDetails(mediaId, resultMediaType);
        const mediaInfo = convertToMediaInfo(details, resultMediaType);

        if (includePhotos) {
            const photos = await fetchPhotosFromWeb(movieName, resultMediaType);
            mediaInfo.photos = photos;
        }

        return { success: true, data: mediaInfo };
    } catch (error) {
        logger.error(`查询影视信息失败: ${error.message}`);
        return { success: false, data: null, error: error.message };
    }
}

module.exports = { queryMediaInfo };
