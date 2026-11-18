/**
 * 格式化相关工具函数
 */

/**
 * 将日期字符串格式化为相对时间（如"2小时前"、"昨天"等）
 * 与旧项目 demo/js/utils/helper.js 中 formatTimeStr 行为一致
 * @param dateString - 日期字符串或时间戳
 * @returns 格式化后的相对时间字符串
 */
export function formatRelativeTime(dateString: string | number | undefined): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        if (minutes === 0) return '刚刚';
        return `${minutes}分钟前`;
      }
      return `${hours}小时前`;
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days}天前`;
    } else if (days < 30) {
      return `${Math.floor(days / 7)}周前`;
    } else if (days < 365) {
      return `${Math.floor(days / 30)}个月前`;
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  } catch {
    return '';
  }
}
