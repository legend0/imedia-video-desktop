// MovieInfoFetcher.js - TMDB网页爬取类库
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./log');
 
class MovieInfoFetcher {
    constructor(baseUrl = 'https://www.themoviedb.org') {
        this.baseUrl = baseUrl;
        this.axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            }
        });
    }

    /**
     * 主方法：传入电影名称，获取完整信息
     * @param {string} movieName - 电影名称
     * @returns {Promise<Object>} - 包含电影信息的对象
     */
    async fetchMovieInfo(movieName) {
        try {
            logger.debug(`开始搜索电影: "${movieName}"`);
            
            // 1. 搜索电影并获取详情页URL
            const movieDetailUrl = await this.searchMovie(movieName);
            if (!movieDetailUrl) {
                throw new Error(`未找到与 "${movieName}" 相关的电影`);
            }
            logger.debug(`找到详情页: ${movieDetailUrl}`);

            // 2. 获取并解析详情页
            const detailData = await this.fetchMovieDetail(movieDetailUrl);
            
            return {
                success: true,
                movieName: movieName,
                ...detailData,
                fetchedAt: new Date().toISOString()
            };
            
        } catch (error) {
            logger.error(`获取电影信息失败: ${error.message}`);
            return {
                success: false,
                error: error.message,
                movieName: movieName
            };
        }
    }

    /**
     * 搜索电影并返回第一个结果的链接
     * @param {string} query - 搜索词
     * @returns {Promise<string|null>} - 详情页URL或null
     */
    async searchMovie(query) {
        const searchUrl = `${this.baseUrl}/search?query=${encodeURIComponent(query)}`;
        
        try {
            const response = await this.axiosInstance.get(searchUrl);
            const $ = cheerio.load(response.data);

            // 查找第一个 .card 元素下的 .result 链接
            const firstResultLink = $('.card .result').first().attr('href');
            
            if (firstResultLink) {
                return `${this.baseUrl}${firstResultLink}`;
            }
            
            // 备用选择器：某些页面结构可能不同
            const alternativeLink = $('a[href*="/movie/"]').first().attr('href');
            if (alternativeLink) {
                return `${this.baseUrl}${alternativeLink}`;
            }
            
            return null;
        } catch (error) {
            logger.error(`搜索电影失败: ${error.message}`);
            throw new Error(`搜索请求失败: ${error.message}`);
        }
    }

    /**
     * 解析电影详情页
     * @param {string} detailUrl - 详情页URL
     * @returns {Promise<Object>} - 解析后的电影数据
     */
    async fetchMovieDetail(detailUrl) {
        try {
            const response = await this.axiosInstance.get(detailUrl);
            const $ = cheerio.load(response.data);

            // 提取电影标题
            const title = $('h2').first().text().trim() || 
                         $('title').text().replace(' — The Movie Database (TMDB)', '').trim();

            // 1. 提取演员信息 (#cast_scroller)
            const cast = [];
            $('#cast_scroller .people.scroller li.card').each((index, element) => {
                const $card = $(element);
                const actorName = $card.find('p:nth-of-type(1) a').text().trim();
                const character = $card.find('p.character').text().trim();
                
                // 获取头像URL - 优先data-src，其次src
                let avatar = $card.find('img.profile').attr('data-src') || 
                            $card.find('img.profile').attr('src') || '';
                
                // 清理URL，移除srcset部分
                if (avatar) {
                    avatar = avatar.split(' ')[0];
                }

                if (actorName) {
                    cast.push({
                        name: actorName,
                        character: character || '未知角色',
                        avatar: avatar,
                        index: index + 1
                    });
                }
            });

            // 2. 提取剧照信息 (#media_scroller)
            const photos = [];
            $('#media_scroller .backdrop img.backdrop').each((index, element) => {
                const $img = $(element);
                let photoUrl = $img.attr('data-src') || $img.attr('src') || '';
                
                // 清理URL，移除srcset部分
                if (photoUrl) {
                    photoUrl = photoUrl.split(' ')[0];
                    photos.push({
                        url: photoUrl,
                        alt: $img.attr('alt') || `剧照 ${index + 1}`,
                        index: index + 1
                    });
                }
            });

            // 3. 提取评论信息
            const reviews = [];
            $('.card').each((index, element) => {
                const $card = $(element);
                const $info = $card.find('.info');
                
                // 检查是否包含评论相关元素
                if ($info.length > 0 && $card.find('.teaser').length > 0) {
                    const reviewerName = $info.find('h3 a').text().trim() || 
                                       $info.find('h5 a').text().trim();
                    const reviewTitle = $info.find('h3').text().trim();
                    const reviewDate = $info.find('h5').text().match(/\d{4} 年 \d{1,2} 月 \d{1,2} 日/)?.[0] || '';
                    const ratingText = $info.find('.rating').text().trim();
                    
                    // 提取评分百分比
                    let rating = null;
                    if (ratingText) {
                        const match = ratingText.match(/(\d+)%/);
                        if (match) rating = parseInt(match[1]);
                    }
                    
                    // 提取评论内容
                    const content = $card.find('.teaser p').text()
                        .replace(/&lrm;/g, '') // 清理特殊字符
                        .trim();
                    
                    if (content || reviewerName) {
                        reviews.push({
                            reviewer: reviewerName || '匿名用户',
                            title: reviewTitle,
                            content: content,
                            rating: rating,
                            date: reviewDate,
                            index: reviews.length + 1
                        });
                    }
                }
            });

            return {
                title: title,
                detailUrl: detailUrl,
                cast: {
                    count: cast.length,
                    list: cast
                },
                photos: {
                    count: photos.length,
                    list: photos
                },
                reviews: {
                    count: reviews.length,
                    list: reviews
                }
            };
            
        } catch (error) {
            logger.error(`解析详情页失败: ${error.message}`);
            throw new Error(`解析电影详情失败: ${error.message}`);
        }
    }

    /**
     * 批量搜索电影
     * @param {Array<string>} movieNames - 电影名称数组
     * @returns {Promise<Array>} - 所有电影的结果数组
     */
    async fetchMultipleMovies(movieNames) {
        const results = [];
        for (const movieName of movieNames) {
            try {
                const result = await this.fetchMovieInfo(movieName);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    movieName: movieName,
                    error: error.message
                });
            }
            // 延迟1秒避免请求过快
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return results;
    }
}

module.exports = MovieInfoFetcher;