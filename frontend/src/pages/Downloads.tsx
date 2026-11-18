import React, { useState, useMemo } from 'react';
import {
  DownloadCloud,
  Trash2,
  Play,
  Pause,
  CheckCircle,
  XCircle,
  Loader2,
  FolderOpen,
  FileText,
  RefreshCw,
  ImageOff,
  AlertTriangle,
  Clock,
  LockOpen,
  PlayCircle,
  FolderPlus,
  CheckCircle2,
  Circle,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDownloads, type DownloadTask, type DownloadTaskStatus } from '@/contexts/DownloadsContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { LazyImage } from '@/components/LazyImage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** 状态对应的图标、文本与颜色 */
const STATUS_INFO: Record<DownloadTaskStatus, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: '等待中', icon: <Clock className="h-4 w-4" />, color: 'text-muted-foreground' },
  downloading: { label: '下载中', icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-brand' },
  paused: { label: '已暂停', icon: <Pause className="h-4 w-4" />, color: 'text-orange' },
  transcoding: { label: '转码中', icon: <RefreshCw className="h-4 w-4 animate-spin" />, color: 'text-purple' },
  decrypting: { label: '解密中', icon: <LockOpen className="h-4 w-4 animate-pulse" />, color: 'text-blue' },
  completed: { label: '已完成', icon: <CheckCircle className="h-4 w-4" />, color: 'text-green' },
  failed: { label: '失败', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  missing: { label: '文件缺失', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-orange' },
};

/** 下载标签页类型 */
type DownloadTab = 'all' | DownloadTaskStatus;

/** 标签页配置：参考 demo 的侧边栏分类 */
const TABS: { key: DownloadTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'downloading', label: '下载中' },
  { key: 'pending', label: '等待中' },
  { key: 'paused', label: '已暂停' },
  { key: 'completed', label: '已完成' },
  { key: 'transcoding', label: '转码中' },
  { key: 'decrypting', label: '解密中' },
  { key: 'failed', label: '失败' },
  { key: 'missing', label: '文件缺失' },
];

/**
 * 格式化文件大小（字节 -> 自适应单位）
 * @param bytes - 字节数
 * @returns 形如 "1.23 MB" 的字符串；入参为 0/空时返回 "未知大小"
 */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '未知大小';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * 格式化下载速度（后端 speed 单位为 KB/s）
 * @param kbPerSecond - 速度值（KB/s）
 * @returns 形如 "1.23 MB/s" 的字符串；入参为 0/空时返回 "0 B/s"
 */
function formatSpeed(kbPerSecond?: number): string {
  if (!kbPerSecond || kbPerSecond <= 0) return '0 B/s';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const bytes = kbPerSecond * 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}/s`;
}

/**
 * 格式化剩余时间（秒 -> mm:ss 或 hh:mm:ss）
 * @param seconds - 剩余秒数
 * @returns 形如 "12:34" 的字符串；入参为 0/空时返回 "--:--"
 */
function formatETA(seconds?: number): string {
  if (!seconds || seconds <= 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

const Downloads: React.FC = () => {
  const {
    tasks,
    toggleStatus,
    removeTask,
    retryTask,
    playTask,
    openFile,
    openDir,
    selectDownloadDir,
    pauseAll,
    resumeAll,
    retryAllFailed,
    clearCompleted,
    clearFailed,
  } = useDownloads();
  const [deleting, setDeleting] = useState<DownloadTask | null>(null);
  const [currentTab, setCurrentTab] = useState<DownloadTab>('all');

  /** 多选状态：选中任务 ID 集合 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /** 切换某个任务的选中状态 */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** 全选当前标签页下的任务 */
  const selectAll = () => {
    setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
  };

  /** 清空选中 */
  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  /** 批量暂停选中的下载中任务 */
  const batchPause = () => {
    selectedIds.forEach((id) => {
      const t = tasks.find((x) => x.id === id);
      if (t && (t.status === 'downloading' || t.status === 'pending')) {
        toggleStatus(id);
      }
    });
    clearSelection();
  };

  /** 批量恢复选中的已暂停/等待任务 */
  const batchResume = () => {
    selectedIds.forEach((id) => {
      const t = tasks.find((x) => x.id === id);
      if (t && (t.status === 'paused' || t.status === 'pending')) {
        toggleStatus(id);
      }
    });
    clearSelection();
  };

  /** 批量重试选中的失败/缺失任务 */
  const batchRetry = () => {
    selectedIds.forEach((id) => {
      const t = tasks.find((x) => x.id === id);
      if (t && (t.status === 'failed' || t.status === 'missing')) {
        retryTask(id);
      }
    });
    clearSelection();
  };

  /** 批量删除选中的任务（已选中数量较少时直接走单条删除确认流程） */
  const batchDelete = () => {
    const targets = tasks.filter((t) => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // 简化：直接对每个任务调用 removeTask；已完成/失败/缺失同时删除文件
    targets.forEach((t) => {
      const deleteFiles = t.status === 'completed' || t.status === 'failed' || t.status === 'missing';
      removeTask(t.id, deleteFiles);
    });
    clearSelection();
  };

  /** 选中数量 */
  const selectedCount = selectedIds.size;

  /** 各状态任务数量统计，用于标签页计数和批量操作按钮的禁用判断 */
  const counts = useMemo(() => {
    const result: Record<DownloadTaskStatus, number> = {
      pending: 0,
      downloading: 0,
      paused: 0,
      transcoding: 0,
      decrypting: 0,
      completed: 0,
      failed: 0,
      missing: 0,
    };
    tasks.forEach((t) => {
      result[t.status]++;
    });
    return result;
  }, [tasks]);

  /** 按当前标签页筛选任务 */
  const filteredTasks = useMemo(() => {
    if (currentTab === 'all') return tasks;
    return tasks.filter((t) => t.status === currentTab);
  }, [tasks, currentTab]);

  /** 获取标签页计数 */
  const getTabCount = (tab: DownloadTab): number => {
    if (tab === 'all') return tasks.length;
    return counts[tab] || 0;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-orange flex items-center justify-center shadow-md">
            <DownloadCloud className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">下载管理</h1>
          {tasks.length > 0 && (
            <span className="text-sm text-muted-foreground">共 {tasks.length} 个任务</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => selectDownloadDir()}
          className="gap-1.5 rounded-xl"
        >
          <FolderPlus className="h-4 w-4" />
          <span className="hidden sm:inline">下载目录</span>
        </Button>
      </div>

      {/* 标签页 + 批量操作：左侧 tabs，右侧操作按钮 */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 flex-1 min-w-0">
            {selectedCount > 0 ? (
              <div className="flex items-center gap-2 px-2 h-8 text-sm text-muted-foreground whitespace-nowrap">
                <span className="text-foreground font-medium">已选中 {selectedCount} 项</span>
                <button
                  onClick={selectAll}
                  className="text-brand hover:underline text-xs"
                  title="选中当前标签页的全部任务"
                >
                  全选
                </button>
              </div>
            ) : (
              TABS.map((tab) => {
                const count = getTabCount(tab.key);
                const active = currentTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setCurrentTab(tab.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 h-8 rounded-xl text-sm font-medium whitespace-nowrap transition-colors',
                      active
                        ? 'bg-brand/10 text-brand'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span
                        className={cn(
                          'text-xs px-1.5 rounded-full',
                          active ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {selectedCount > 0 ? (
              <>
                <Button variant="outline" size="sm" onClick={batchPause} className="gap-1.5 rounded-xl" title="批量暂停">
                  <Pause className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={batchResume} className="gap-1.5 rounded-xl" title="批量恢复">
                  <Play className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={batchRetry} className="gap-1.5 rounded-xl" title="批量重试">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <div className="h-5 w-px bg-border" />
                <Button variant="outline" size="sm" onClick={batchDelete} className="gap-1.5 rounded-xl text-destructive hover:bg-destructive/10" title="批量删除">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection} className="gap-1.5 rounded-xl" title="退出多选">
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={pauseAll} disabled={counts.downloading === 0} className="gap-1.5 rounded-xl" title="全部暂停">
                  <Pause className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={resumeAll} disabled={counts.paused === 0 && counts.pending === 0} className="gap-1.5 rounded-xl" title="全部恢复">
                  <Play className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={retryAllFailed} disabled={counts.failed === 0} className="gap-1.5 rounded-xl" title="重试全部失败">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <div className="h-5 w-px bg-border" />
                <Button variant="outline" size="sm" onClick={clearCompleted} disabled={counts.completed === 0} className="gap-1.5 rounded-xl" title="清空已完成">
                  <CheckCircle className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={clearFailed} disabled={counts.failed === 0} className="gap-1.5 rounded-xl text-destructive hover:bg-destructive/10" title="清空失败">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60">
          <div className="w-16 h-16 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
            <DownloadCloud className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm">暂无下载任务</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60">
          <div className="w-16 h-16 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
            <DownloadCloud className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm">当前分类下暂无任务</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => {
            const status = STATUS_INFO[task.status];
            const isDownloading = task.status === 'downloading';
            const isPaused = task.status === 'paused';
            const isPending = task.status === 'pending';
            const isFailed = task.status === 'failed';
            const isCompleted = task.status === 'completed';
            const isMissing = task.status === 'missing';
            const isTranscoding = task.status === 'transcoding';
            const isDecrypting = task.status === 'decrypting';
            // 转码/解密进度优先于下载进度
            let displayProgress = task.progress;
            if (isTranscoding) displayProgress = task.transcodingProgress ?? 0;
            else if (isDecrypting) displayProgress = task.decryptingProgress ?? 0;

            const isSelected = selectedIds.has(task.id);

            return (
              <div
                key={task.id}
                className={cn(
                  'relative rounded-xl bg-card p-4 shadow-card transition-all group',
                  isSelected
                    ? 'ring-2 ring-brand shadow-hover'
                    : 'hover:shadow-hover'
                )}
              >
                {/* 左上角多选框：悬浮或已选中时显示 */}
                <button
                  onClick={() => toggleSelect(task.id)}
                  className={cn(
                    'absolute top-2 left-2 z-10 rounded-full transition-opacity',
                    isSelected
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                  )}
                  title={isSelected ? '取消选中' : '选中'}
                  aria-label={isSelected ? '取消选中' : '选中'}
                >
                  {isSelected ? (
                    <CheckCircle2 className="h-5 w-5 text-brand bg-card rounded-full" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground bg-card rounded-full" />
                  )}
                </button>
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  {/* 缩略图 */}
                  <div className="relative shrink-0 overflow-hidden rounded-lg bg-muted w-full md:w-32 aspect-video md:aspect-[16/9]">
                    {task.thumbnail ? (
                      <LazyImage
                        src={task.thumbnail}
                        alt={task.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageOff className="h-6 w-6 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  {/* 主体信息 */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="truncate text-sm font-semibold text-foreground" title={task.title}>
                          {task.title}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* 操作按钮：暂停/继续 */}
                        {(isDownloading || isPaused || isPending || isFailed) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleStatus(task.id)}
                            className="rounded-lg px-2"
                            title={isDownloading ? '暂停' : '继续'}
                          >
                            {isDownloading ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                        )}
                        {/* 重试 */}
                        {isFailed && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryTask(task.id)}
                            className="rounded-lg px-2"
                            title="重试"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {/* 重新下载（文件缺失） */}
                        {isMissing && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryTask(task.id)}
                            className="rounded-lg px-2"
                            title="重新下载"
                          >
                            <DownloadCloud className="h-4 w-4" />
                          </Button>
                        )}
                        {/* 播放 / 打开文件 / 打开文件夹 */}
                        {isCompleted && task.outputPath && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => playTask(task)}
                              className="rounded-lg px-2"
                              title="播放"
                            >
                              <PlayCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openFile(task.outputPath!)}
                              className="rounded-lg px-2"
                              title="打开文件"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDir(task.outputPath!)}
                              className="rounded-lg px-2"
                              title="打开文件夹"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {/* 删除/取消 */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleting(task)}
                          className="rounded-lg px-2 text-destructive hover:bg-destructive/10"
                          title={isCompleted || isFailed || isMissing ? '删除' : '取消'}
                        >
                          {isCompleted || isFailed || isMissing ? <Trash2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        </Button>
                        {/* 状态图标 + 状态文字 */}
                        <div className={cn('shrink-0', status.color)}>{status.icon}</div>
                        <span className={cn('text-xs whitespace-nowrap', status.color)}>{status.label}</span>
                      </div>
                    </div>

                    {/* 元信息：根据状态展示不同内容 */}
                    <div className="text-xs text-muted-foreground space-y-1">
                      {isDownloading && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>
                            已下载：{formatFileSize(task.downloadedSize)}
                            {task.finalSize ? ` / ${formatFileSize(task.finalSize)}` : ''}
                          </span>
                          <span>速度：{formatSpeed(task.rawSpeed)}</span>
                          <span>剩余：{formatETA(task.remainingTime)}</span>
                        </div>
                      )}
                      {isPaused && (
                        <span>已下载：{formatFileSize(task.downloadedSize)}</span>
                      )}
                      {isCompleted && task.outputPath && (
                        <span>大小：{formatFileSize(task.finalSize)}</span>
                      )}
                      {isCompleted && !task.outputPath && (
                        <span className="text-destructive">文件路径不可用</span>
                      )}
                      {isTranscoding && (
                        <span>转码进度：{task.transcodingProgress ?? 0}%</span>
                      )}
                      {isDecrypting && (
                        <span>解密进度：{task.decryptingProgress ?? 0}%</span>
                      )}
                      {isFailed && (
                        <span className="text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {task.error || '未知错误'}
                        </span>
                      )}
                      {isMissing && (
                        <span className="text-orange flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {task.error || '输出文件不存在，可点击重新下载'}
                        </span>
                      )}
                    </div>

                    {/* 进度条：下载中/转码中/解密中/已暂停 都显示 */}
                    {(isDownloading || isTranscoding || isDecrypting || isPaused) && (
                      <div className="flex items-center gap-3">
                        <Progress value={displayProgress} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                          {displayProgress}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting && (deleting.status === 'completed' || deleting.status === 'failed' || deleting.status === 'missing')
                ? '确认删除'
                : '确认取消'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (deleting.status === 'completed' || deleting.status === 'failed' || deleting.status === 'missing')
                ? `确定要删除任务「${deleting?.title}」吗？此操作将同时删除相关的下载文件，且不可撤销。`
                : `确定要取消下载任务「${deleting?.title}」吗？已下载的文件将被保留。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleting(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) {
                  const deleteFiles =
                    deleting.status === 'completed' || deleting.status === 'failed' || deleting.status === 'missing';
                  removeTask(deleting.id, deleteFiles);
                }
                setDeleting(null);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Downloads;
