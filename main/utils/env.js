/**
 * 环境检测工具
 */

/**
 * 开发环境检测（多重检测，不依赖单一环境变量）
 * @returns {boolean} 是否为开发环境
 */
function checkIsDev() {
  return process.env.NODE_ENV === 'development' ||
         process.argv.includes('--dev') ||
         process.execPath.includes('node_modules\\electron') ||
         process.execPath.includes('node_modules/electron');
}

/** 预计算的开发环境标志（模块加载时确定） */
const isDev = checkIsDev();

module.exports = { isDev, checkIsDev };
