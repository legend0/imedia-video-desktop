/**
 * 剩余时间估算模块
 * 提供智能的下载剩余时间计算功能
 */

/**
 * 计算加权平均值
 * @param {number[]} values - 值数组
 * @param {number[]} weights - 权重数组
 * @returns {number} 加权平均值
 */
function calculateWeightedAverage(values, weights) {
  if (values.length === 0) return 0;
  if (values.length !== weights.length) {
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }
  const weightedSum = values.reduce((acc, val, index) => acc + val * weights[index], 0);
  const weightSum = weights.reduce((acc, weight) => acc + weight, 0);
  return weightSum > 0 ? weightedSum / weightSum : 0;
}

/**
 * 过滤异常值
 * @param {number[]} values - 值数组
 * @returns {number[]} 过滤后的值数组
 */
function filterOutliers(values) {
  if (values.length <= 2) return values;

  const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return values.filter(val => Math.abs(val - mean) <= 2 * stdDev);
}

/**
 * 计算速度趋势
 * @param {number[]} speeds - 速度数组
 * @returns {number} 趋势系数 (1.0表示稳定，>1表示加速，<1表示减速)
 */
function calculateSpeedTrend(speeds) {
  if (speeds.length < 3) return 1.0;

  const n = speeds.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = speeds.reduce((acc, val) => acc + val, 0);
  const sumXY = speeds.reduce((acc, val, index) => acc + val * index, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgSpeed = sumY / n;

  if (avgSpeed === 0) return 1.0;

  const trend = 1 + (slope / avgSpeed);
  return Math.max(0.5, Math.min(1.5, trend));
}

/**
 * 智能估算下载剩余时间
 * @param {Object} task - 任务对象
 * @param {number} downloadedCount - 已下载分片数
 * @param {number} totalCount - 总分片数
 * @param {number} downloadedSize - 已下载大小（字节）
 * @param {number} totalSize - 总大小（字节）
 * @param {number} startTime - 开始时间戳
 * @returns {{progress: number, speed: number, remainingTime: number}} 包含速度和剩余时间的对象
 */
function estimateRemainingTime(task, downloadedCount, totalCount, downloadedSize, totalSize, startTime) {
  const progress = Math.round((downloadedCount / totalCount) * 100);
  const elapsedTime = (Date.now() - startTime) / 1000;
  const remainingBytes = totalSize - downloadedSize;

  let speed = 0;
  let remainingTime = 0;

  if (downloadedSize > 0 && elapsedTime > 0) {
    const baseSpeed = downloadedSize / elapsedTime / 1024;

    if (task.downloadStats && task.downloadStats.segmentTimes.length > 0) {
      const segmentTimes = task.downloadStats.segmentTimes;
      const segmentSizes = task.downloadStats.segmentSizes;

      const filteredTimes = filterOutliers(segmentTimes);
      const filteredSizes = segmentSizes.slice(segmentSizes.length - filteredTimes.length);

      if (filteredTimes.length > 0) {
        const recentSpeeds = filteredSizes.map((size, index) => {
          return filteredTimes[index] > 0 ? size / filteredTimes[index] / 1024 : 0;
        }).filter(s => s > 0);

        if (recentSpeeds.length > 0) {
          const weights = recentSpeeds.map((_, index) => index + 1);
          const weightedSpeed = calculateWeightedAverage(recentSpeeds, weights);
          const trend = calculateSpeedTrend(recentSpeeds);

          let baseWeight, recentWeight;
          if (progress < 10) {
            baseWeight = 0.3;
            recentWeight = 0.7;
          } else if (progress < 90) {
            baseWeight = 0.4;
            recentWeight = 0.6;
          } else {
            baseWeight = 0.7;
            recentWeight = 0.3;
          }

          speed = (baseSpeed * baseWeight + weightedSpeed * recentWeight) * trend;
        } else {
          speed = baseSpeed;
        }
      } else {
        speed = baseSpeed;
      }
    } else {
      speed = baseSpeed;
    }

    if (speed > 0) {
      const timeBySpeed = remainingBytes / (speed * 1024);

      let timeByProgress = 0;
      if (progress > 0 && progress < 100) {
        timeByProgress = (elapsedTime / progress) * (100 - progress);
      }

      let speedWeight, progressWeight;
      if (progress < 30) {
        speedWeight = 0.8;
        progressWeight = 0.2;
      } else if (progress < 70) {
        speedWeight = 0.5;
        progressWeight = 0.5;
      } else {
        speedWeight = 0.2;
        progressWeight = 0.8;
      }

      remainingTime = timeBySpeed * speedWeight + timeByProgress * progressWeight;
    }
  }

  if (task.remainingTime && task.remainingTime > 0) {
    const alpha = 0.3;
    remainingTime = task.remainingTime * (1 - alpha) + remainingTime * alpha;
  }

  return {
    progress,
    speed: Math.round(speed),
    remainingTime: Math.round(remainingTime)
  };
}

/**
 * 更新任务下载进度
 * @param {Object} task - 任务对象
 * @param {number} downloadedCount - 已下载分片数
 * @param {number} totalCount - 总分片数
 * @param {number} downloadedSize - 已下载大小（字节）
 * @param {number} totalSize - 总大小（字节）
 * @param {number} startTime - 开始时间戳
 * @param {Function} [updateCallback] - 更新回调函数
 * @returns {Object} 更新后的任务状态
 */
function updateTaskProgress(task, downloadedCount, totalCount, downloadedSize, totalSize, startTime, updateCallback) {
  const estimation = estimateRemainingTime(
    task,
    downloadedCount,
    totalCount,
    downloadedSize,
    totalSize,
    startTime
  );

  const updatedTask = {
    ...task,
    downloadedSegments: downloadedCount,
    progress: estimation.progress,
    speed: estimation.speed,
    remainingTime: estimation.remainingTime
  };

  if (updateCallback) {
    updateCallback(updatedTask);
  }

  return updatedTask;
}

module.exports = {
  calculateWeightedAverage,
  filterOutliers,
  calculateSpeedTrend,
  estimateRemainingTime,
  updateTaskProgress
};
