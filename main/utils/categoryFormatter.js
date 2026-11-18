/**
 * 分类处理工具
 * 根据API返回的分类数据和用户设置，格式化分类
 */
const settings = require('../core/settings');
const log = require('./log');

// 预定义分类规则
const categoryRules = [
    {
        id: "1",
        name: "电影",
        icon: "icon-yingshi",
        subcategories: [],
        keywords: [
            "动作片",
            "喜剧片",
            "爱情片",
            "科幻片",
            "悬疑片",
            "剧情片",
            "战争片",
            "恐怖片",
            "邵氏电影",
            "4K电影",
            "动漫电影",
            "其他片",
            "纪录片",
            "犯罪片",
            "历史片",
            "灾难片",
            "古装片",
            "家庭片",
            "惊悚片",
            "短片",
            "奇幻片",
            "电影"
        ],
    },
    {
        id: "2",
        name: "电视剧",
        icon: "icon-dianshiju1",
        subcategories: [],
        keywords: [
            "香港剧",
            "台湾剧",
            "日本剧",
            "港剧",
            "泰剧",
            "台剧",
            "韩国剧",
            "海外剧",
            "泰国剧",
            "欧美剧",
            "记录片",
            "韩剧",
            "美剧",
            "日剧",
            "国产剧",
            "港澳剧",
            "大陆剧",
            "台湾剧",
            "马泰剧",
            "内地剧",
            "电视剧",
            "连续剧",
        ],
    },
    {
        id: "3",
        name: "综艺",
        icon: "icon-huodong",
        subcategories: [],
        keywords: [
            "日本综艺",
            "大陆综艺",
            "港台综艺",
            "日韩综艺",
            "欧美综艺",
            "韩国综艺",
            "真人秀",
            "脱口秀",
            "音乐节目",
            "选秀节目",
            "综艺",
            "娱乐节目",
        ],
    },
    {
        id: "4",
        name: "动漫",
        icon: "icon-dongman",
        subcategories: [],
        keywords: [
            "日本动漫",
            "国产动漫",
            "欧美动漫",
            "海外动漫",
            "日韩动漫",
            "国产动漫",
            "动画片",
            "港台动漫",
            "中国动漫",
            "有声动漫",
            "动漫",
            "动画",
        ],
    },
    {
        id: "5",
        name: "其他",
        icon: "icon-ziyuan",
        subcategories: [],
        keywords: [
            "短剧",
            "演唱会",
            "体育赛事",
            "篮球",
            "足球",
            "预告片",
            "斯诺克",
            "影视解说",
            "爽文短剧",
            "写真热舞",
            "女频恋爱",
            "反转爽剧",
            "古装仙侠",
            "年代穿越",
            "脑洞悬疑",
            "现代都市",
            "纪录片",
            "微电影",
        ],
    }
];

// 成人内容分类规则
const adultCategoryRules = [
    {
        id: "6",
        name: "成人内容",
        icon: "icon-anquan",
        subcategories: [],
        keywords: [
            "伦理片",
            "伦理",
            "港台三级",
            "韩国伦理",
            "西方伦理",
            "日本伦理",
            "两性课堂",
            "成人",
            "三级",
            "情色",
        ],
    }
];
// 成人内容详细分类字符串
const adultCategoryStr = `
国产视频=国产视频,国产,自拍,国产精品,国产区,情趣,偷拍,国产盗摄,网友自拍,街拍偷拍,交换,不偷,不伦,恋情,绿帽,淫妻,强奸,迷奸
91麻豆=麻豆,91,传媒自拍,麻豆传媒,华语AV,国产传媒,国产探花,传媒,角色,国产主播,剧情,裸聊,美女,直播,探花,主播,乱伦,网红,头条,户外,影业,台湾
日韩专区=情色,AV区,魔镜,时间,催眠,洗脑,漫改,电车,痴汉,淫欲,痴女,中文,字幕,有码,日本无码,无码,日本,素人,绝顶,潮吹,亚洲,人妻,女优,颜射,韩国
欧美精品=欧美性爱,欧美自拍,欧美系列,欧美风情,欧美无码,欧美,欧美区,欧美情色
暴力重口=熟女,强奸,美乳,巨乳,女同性恋,重口色情,人兽性交,人兽,同性,SM,人妖,TS专区,女性向系列,暴力,虐待,女同,性爱,调教,重口,暴力
热门事件=网曝,黑料,吃瓜,事件,爆料,热门,黑人,群交,多人,反差
情色动漫=动漫,肉番,禁漫,漫
伦理三级=伦理,三级,明星,绝色,佳人,风俗,泡泡浴,玄幻,仙侠,极品,媚黑,明星换脸,换脸
福利姬=露出,激情,主播,抖音,韩国,泰国,风情,科学,幻想,萝莉,少女,抖阴,漏出,高潮,喷水,自慰,少女,萝莉,制服,诱惑,丝袜,美腿,解说
其他=其他,视频一区,视频二区,虚拟VR,VR视角,AV解说,生活都市,学生校园,视频1区,视频2区,学生,强制侵犯,其他区,视频三区,视频四区,视频五区`;

/**
 * 格式化成人内容分类字符串为分类规则
 * @returns {Array} 格式化后的成人内容分类规则
 */
function formatAdultCategoryStr() {
    const rules = [];
    
    // 解析adultCategoryStr字符串，将其转换为与categoryRules相同格式的对象
    const lines = adultCategoryStr.split('\n').filter(line => line.trim() !== '');
    lines.forEach((line, index) => {
        const [name, keywordsStr] = line.split('=');
        if (name) {
            // 即使没有关键词也创建规则（如"其他"分类）
            const keywords = keywordsStr ? keywordsStr.split(',').map(keyword => keyword.trim()) : [];
            rules.push({
                id: String(index + 1), // 从1开始编号
                name: name.trim(),
                icon: "icon-anquan", // 所有成人内容子分类统一使用 icon-anquan
                subcategories: [],
                keywords: keywords
            });
        }
    });
    
    return rules;
}

/**
 * 查找匹配的分类规则
 * @param {string} categoryName - 分类名称
 * @param {Array} rules - 分类规则
 * @param {boolean} isAdult - 是否是成人源
 * @returns {Object|null} 匹配的规则
 */
function findMatchingRule(categoryName, rules, isAdult = false) {
    if (isAdult) {
        // 成人源使用模糊匹配
        for (const rule of rules) {
            // 检查规则的关键词是否包含分类名称
            if (rule.keywords && rule.keywords.some(keyword => {
                // 确保keyword和categoryName都是字符串
                const keywordStr = String(keyword).trim();
                const categoryStr = String(categoryName).trim();
                return (
                    categoryStr.includes(keywordStr) ||
                    keywordStr.includes(categoryStr) ||
                    categoryStr.toLowerCase().includes(keywordStr.toLowerCase()) ||
                    keywordStr.toLowerCase().includes(categoryStr.toLowerCase())
                );
            })) {
                return rule;
            }
        }
    } else {
        // 非成人源使用精确匹配
        return rules.find((rule) => {
            return rule.keywords.some((keyword) => {
                return categoryName === keyword;
            });
        });
    }
    return null;
}

/**
 * 获取格式化后的分类
 * @param {Array} apiCategories - API返回的分类数据
 * @param {boolean} isAdultSource - 是否是成人源
 * @returns {Array} 格式化后的分类
 */
async function getFormattedCategories(apiCategories, isAdultSource = false) {
    try {
        // 获取用户设置
        const showAdultContent = await settings.getSetting('ui.showAdult', false);
        
        // 根据源类型选择分类规则
        let rules;
        if (isAdultSource) {
            // 成人源只使用adultCategoryStr规则
            rules = formatAdultCategoryStr();
        } else {
            // 非成人源使用所有规则进行匹配，包括基础成人分类规则
            rules = categoryRules.concat(adultCategoryRules);
        }
        
        // 重置子分类
        rules.forEach((rule) => {
            rule.subcategories = [];
        });

        // 匹配API分类到预定义规则
        apiCategories.forEach((apiCategory) => {
            const categoryName = apiCategory.type_name || apiCategory.name;
            const categoryId = apiCategory.type_id || apiCategory.id;

            // 查找匹配的规则
            const matchedRule = findMatchingRule(categoryName, rules, isAdultSource);

            if (matchedRule) {
                matchedRule.subcategories.push({
                    id: categoryId.toString(),
                    name: categoryName,
                    originalData: apiCategory,
                });
            } else {
                // 未匹配的分类放入"其他"
                const otherRule = rules.find((rule) => rule.name === "其他");
                if (otherRule) {
                    otherRule.subcategories.push({
                        id: categoryId.toString(),
                        name: categoryName,
                        originalData: apiCategory,
                    });
                }
            }


            
        });
        
        // 过滤掉没有子分类的规则或者子分类中名称和父分类名称相同的子分类
        let formattedCategories = rules
            .filter(rule => rule.subcategories && rule.subcategories.length > 0) // 先过滤掉没有子分类的规则
            .map(rule => {
                return {
                    ...rule,
                    subcategories: rule.subcategories.filter(sub => sub.name !== rule.name) // 去掉子分类中和父分类同名的项
                };
            });
        
        // 根据用户设置决定是否显示成人内容分类（第6个分类）
        if (!showAdultContent) {
            formattedCategories = formattedCategories.filter(rule => rule.id !== "6");
        }
        
        return formattedCategories;
    } catch (error) {
        log.error(`格式化分类失败: ${error.message}`, error);
        return [];
    }
}

module.exports = {
    getFormattedCategories,
    categoryRules,
    adultCategoryRules,
    findMatchingRule
};