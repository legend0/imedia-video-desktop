import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useSound } from '@/contexts/SoundContext';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * 下载任务状态
 * - pending: 等待中（后端 waiting）
 * - downloading: 下载中
 * - paused: 已暂停
 * - transcoding: 转码中
 * - completed: 已完成
 * - failed: 失败
 * - missing: 文件缺失（已完成但输出文件被删除/移动，可重新下载）
 */
export type DownloadTaskStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'transcoding'
  | 'decrypting'
  | 'completed'
  | 'failed'
  | 'missing';

export interface DownloadTask {
  id: string;
  title: string;
  progress: number;
  status: DownloadTaskStatus;
  /** 缩略图 URL */
  thumbnail?: string;
  /** 下载速度（KB/s，后端原始单位） */
  rawSpeed?: number;
  /** 剩余时间（秒） */
  remainingTime?: number;
  /** 最终文件大小（字节） */
  finalSize?: number;
  /** 已下载大小（字节，来自 downloadStats.totalDownloadedSize） */
  downloadedSize?: number;
  /** 输出文件路径（completed 状态下用于打开文件/文件夹） */
  outputPath?: string;
  /** 错误信息（failed 状态下填充） */
  error?: string;
  /** 转码进度（0-100，transcoding 状态下使用） */
  transcodingProgress?: number;
  /** 解密进度（0-100，decrypting 状态下使用） */
  decryptingProgress?: number;
  /** 原始视频数据（用于播放器播放已下载文件） */
  videoData?: unknown;
}

/**
 * 添加下载任务的完整参数（对应后端 AddTaskParams）
 */
export interface AddTaskParams {
  /** 下载地址（m3u8/mp4 等可播放 URL），必填 */
  url: string;
  /** 保存的文件名（含扩展名），必填 */
  fileName: string;
  /** 视频封面缩略图 URL */
  thumbnail?: string;
  /** 视频在源中的唯一 ID */
  videoId?: string;
  /** 所属源 key，未提供时后端使用当前激活源 */
  sourceKey?: string;
  /** 视频描述 */
  description?: string;
  /** 画质标签，如 1080P/720P */
  quality?: string;
  /** 原始视频数据，后端会原样保存到 task.videoData */
  videoData?: unknown;
}

interface DownloadsContextType {
  tasks: DownloadTask[];
  addTask: (params: AddTaskParams) => void;
  addBatchTasks: (paramsList: AddTaskParams[]) => void;
  removeTask: (id: string, deleteFiles?: boolean) => void;
  toggleStatus: (id: string) => void;
  /** 重试失败的下载任务 */
  retryTask: (id: string) => void;
  /** 用内置播放器播放已下载的视频 */
  playTask: (task: DownloadTask) => void;
  /** 在系统默认播放器中打开已下载的文件 */
  openFile: (filePath: string) => void;
  /** 在系统文件管理器中定位到指定文件 */
  openDir: (filePath: string) => void;
  /** 选择下载目录 */
  selectDownloadDir: () => Promise<string | null>;
  /** 批量暂停所有下载中的任务 */
  pauseAll: () => void;
  /** 批量恢复所有已暂停/等待中的任务 */
  resumeAll: () => void;
  /** 批量重试所有失败的任务 */
  retryAllFailed: () => void;
  /** 清空所有已完成的任务（保留文件） */
  clearCompleted: () => void;
  /** 清空所有失败的任务（保留文件） */
  clearFailed: () => void;
}

const DownloadsContext = createContext<DownloadsContextType | undefined>(undefined);

/** 后端任务状态到前端状态的映射 */
const STATUS_MAP: Record<string, DownloadTaskStatus> = {
  waiting: 'pending',
  downloading: 'downloading',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  transcoding: 'transcoding',
  decrypting: 'decrypting',
  missing: 'missing',
};

/** 将后端 DownloadTask 转换为前端 DownloadTask 格式 */
function convertTask(task: Record<string, unknown>): DownloadTask {
  const rawStatus = (task.status as string) || 'waiting';
  const downloadStats = (task.downloadStats as Record<string, unknown>) || {};
  return {
    id: String(task.id || ''),
    title: (task.fileName as string) || (task.description as string) || '',
    progress: (task.progress as number) || 0,
    status: STATUS_MAP[rawStatus] || 'pending',
    thumbnail: (task.thumbnail as string) || undefined,
    rawSpeed: (task.speed as number) || undefined,
    remainingTime: (task.remainingTime as number) || undefined,
    finalSize: (task.finalSize as number) || undefined,
    downloadedSize: (downloadStats.totalDownloadedSize as number) || undefined,
    outputPath: (task.outputPath as string) || undefined,
    error: (task.error as string) || undefined,
    transcodingProgress: (task.transcodingProgress as number) || undefined,
    decryptingProgress: (task.decryptingProgress as number) || undefined,
    videoData: task.videoData || undefined,
  };
}

export const DownloadsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { play } = useSound();
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  // 节流相关 refs：进度类更新（非状态变化）合并为 300ms 一次刷新，避免高频 task-update 卡顿
  const tasksRef = useRef<DownloadTask[]>([]);
  tasksRef.current = tasks;
  const throttleRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: DownloadTask | null }>({
    timer: null,
    pending: null,
  });
  // 追踪进行中的添加任务（按 title 去重），防止快速重复点击导致重复 API 调用
  const addingTitlesRef = useRef<Set<string>>(new Set());

  // 用 ref 存储最新回调，确保 IPC 监听器只注册一次，避免 MaxListenersExceeded 内存泄漏
  const playRef = useRef(play);
  playRef.current = play;
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!window.API) return;

    const loadTasks = async () => {
      try {
        const result = await window.API.download.getTaskList();
        // 后端返回 {success, data?, error?}，需解包 data
        const list = result.success && Array.isArray(result.data) ? result.data : [];
        setTasks(list.map((t) => convertTask(t as unknown as Record<string, unknown>)));
      } catch (err) {
        // 加载失败保持空列表，仅记录日志
        console.warn('加载下载任务列表失败:', err);
      }
    };

    loadTasks();

    /** 将单条任务更新应用到 state */
    const applyUpdate = (updated: DownloadTask) => {
      setTasks((prev) => {
        const existsById = prev.some((t) => t.id === updated.id);
        if (existsById) {
          return prev.map((t) => (t.id === updated.id ? updated : t));
        }
        // 替换本地占位任务（id 以 d- 开头的临时任务），通过标题匹配避免重复
        const localIndex = prev.findIndex(
          (t) => t.id.startsWith('d-') && t.title === updated.title
        );
        if (localIndex !== -1) {
          return prev.map((t) => (t.id === prev[localIndex].id ? updated : t));
        }
        return [updated, ...prev];
      });
    };

    const handleTaskUpdate = (task: unknown) => {
      const updated = convertTask(task as Record<string, unknown>);
      const existing = tasksRef.current.find((t) => t.id === updated.id);
      const isStatusChange = !existing || existing.status !== updated.status;

      if (isStatusChange) {
        // 状态变化（含新任务）：立即刷新，取消待处理的节流
        if (throttleRef.current.timer) {
          clearTimeout(throttleRef.current.timer);
          throttleRef.current.timer = null;
        }
        throttleRef.current.pending = null;
        applyUpdate(updated);
      } else {
        // 进度类更新：300ms 节流
        throttleRef.current.pending = updated;
        if (!throttleRef.current.timer) {
          throttleRef.current.timer = setTimeout(() => {
            throttleRef.current.timer = null;
            if (throttleRef.current.pending) {
              applyUpdate(throttleRef.current.pending);
              throttleRef.current.pending = null;
            }
          }, 300);
        }
      }

      // 下载完成/失败时触发对应音效与系统通知（铃铛），避免使用 toast 被忽略
      if (isStatusChange) {
        if (updated.status === 'completed') {
          playRef.current('download:complete');
          addNotificationRef.current({
            type: 'success',
            title: '下载完成',
            message: updated.title,
            action: {
              label: '查看',
              onClick: () => navigateRef.current('/downloads'),
            },
          });
        } else if (updated.status === 'failed') {
          playRef.current('download:failed');
          addNotificationRef.current({
            type: 'error',
            title: '下载失败',
            message: updated.title,
            action: {
              label: '查看',
              onClick: () => navigateRef.current('/downloads'),
            },
          });
        }
      }
    };

    const handleTaskListUpdated = (taskList: unknown) => {
      const list = Array.isArray(taskList) ? taskList : [];
      setTasks(list.map((t) => convertTask(t as unknown as Record<string, unknown>)));
    };

    window.API.on('task-update', handleTaskUpdate);
    window.API.on('task-list-updated', handleTaskListUpdated);

    return () => {
      window.API.off('task-update', handleTaskUpdate);
      window.API.off('task-list-updated', handleTaskListUpdated);
      if (throttleRef.current.timer) {
        clearTimeout(throttleRef.current.timer);
      }
    };
  }, []);

  const addTask = useCallback((params: AddTaskParams) => {
    const localId = `d-${Date.now()}`;
    const title = params.fileName;
    // 去重：已存在同名任务或正在添加中时跳过，防止快速重复点击产生重复 API 调用
    if (tasksRef.current.some((t) => t.title === title) || addingTitlesRef.current.has(title)) {
      toast.info('任务已存在');
      return;
    }
    addingTitlesRef.current.add(title);
    setTasks((prev) => {
      if (prev.some((t) => t.title === title)) return prev;
      return [{ id: localId, title, progress: 0, status: 'pending' }, ...prev];
    });
    if (window.API) {
      window.API.download
        .addTask(params)
        .then((result) => {
          addingTitlesRef.current.delete(title);
          // 后端返回 {success, data: {taskId}}，用真实 taskId 替换本地临时 ID
          if (result.success && result.data?.taskId) {
            setTasks((prev) =>
              prev.map((t) => (t.id === localId ? { ...t, id: result.data!.taskId! } : t))
            );
          }
        })
        .catch((err) => {
          addingTitlesRef.current.delete(title);
          // 移除占位任务，避免失败后残留 0% 进度的永久 pending 任务
          setTasks((prev) => prev.filter((t) => t.id !== localId));
          console.warn('添加下载任务失败:', err);
          toast.error(`下载任务添加失败：${title}`);
        });
    }
    toast.success(`已加入下载：${title}`);
  }, []);

  /** 批量添加下载任务：一次性调用后端 addBatchTasks，避免逐个 addTask 的竞态 */
  const addBatchTasks = useCallback((paramsList: AddTaskParams[]) => {
    if (paramsList.length === 0) return;
    const localIds = paramsList.map((p, i) => `d-${Date.now()}-${i}`);
    setTasks((prev) => {
      const newTasks = paramsList
        .map((p, i) => ({
          id: localIds[i],
          title: p.fileName,
          progress: 0,
          status: 'pending' as const,
        }))
        .filter((nt) => !prev.some((t) => t.title === nt.title));
      return [...newTasks, ...prev];
    });
    if (window.API) {
      window.API.download
        .addBatchTasks(paramsList)
        .then((result) => {
          if (result.success && result.data?.taskIds) {
            setTasks((prev) => {
              let next = prev;
              result.data!.taskIds!.forEach((taskId, i) => {
                next = next.map((t) => (t.id === localIds[i] ? { ...t, id: taskId } : t));
              });
              return next;
            });
          }
        })
        .catch((err) => {
          console.warn('批量添加下载任务失败:', err);
          toast.error('批量下载任务添加失败');
        });
    }
    toast.success(`已加入 ${paramsList.length} 个下载任务`);
  }, []);

  const removeTask = useCallback((id: string, deleteFiles = false) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (window.API) {
      window.API.download.cancelTask(id, deleteFiles).catch(() => {});
    }
  }, []);

  /** 切换任务状态（暂停/恢复）：从 tasksRef 读取当前状态，避免在 setState updater 中执行副作用 */
  const toggleStatus = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    if (task.status === 'downloading') {
      window.API?.download.pauseTask(id).catch((err) => console.warn('暂停任务失败:', err));
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'paused' as const } : t)));
    } else if (task.status === 'paused' || task.status === 'pending' || task.status === 'failed') {
      window.API?.download.resumeTask(id).catch((err) => console.warn('恢复任务失败:', err));
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'downloading' as const } : t)));
    }
  }, []);

  /** 重试失败的下载任务 */
  const retryTask = useCallback((id: string) => {
    if (window.API) {
      window.API.download.retryTask(id).catch(() => {});
    }
  }, []);

  /** 用内置播放器播放已下载的视频：构造本地 file:// URL 并调用 player.open */
  const playTask = useCallback((task: DownloadTask) => {
    if (!task.outputPath) {
      toast.error('文件路径无效');
      return;
    }
    if (window.API?.player?.open) {
      const normalizedPath = task.outputPath.replace(/\\/g, '/');
      const fileUrl = normalizedPath.startsWith('/')
        ? `file://${normalizedPath}`
        : `file:///${normalizedPath}`;
      const baseData = (task.videoData as Record<string, unknown>) || {};
      // 使用 episodes 数组传递，让播放器通过 determineUrlType 正确识别格式
      // 避免使用 vod_play_url 字符串解析导致的格式识别错误
      const videoData = {
        ...baseData,
        title: task.title,
        vod_name: task.title,
        vod_pic: task.thumbnail,
        pic: task.thumbnail,
        episodes: [{ title: task.title, url: fileUrl }],
        episodeIndex: 0,
        currentEpisode: 0,
      };
      window.API.player.open(videoData).catch(() => {
        window.API?.download?.openFile(task.outputPath!).catch(() => {});
      });
    } else {
      window.API?.download?.openFile(task.outputPath).catch(() => {});
    }
  }, []);

  /** 选择下载目录：调用后端目录选择对话框，返回用户选择的路径 */
  const selectDownloadDir = useCallback(async (): Promise<string | null> => {
    if (!window.API?.download?.selectDownloadDir) return null;
    try {
      const result = await window.API.download.selectDownloadDir();
      if (result.success && result.data) {
        toast.success(`下载目录已设置为：${result.data}`);
        return result.data;
      }
      return null;
    } catch {
      toast.error('选择下载目录失败');
      return null;
    }
  }, []);

  /** 打开已下载文件 */
  const openFile = useCallback((filePath: string) => {
    if (!filePath) {
      toast.error('文件路径无效');
      return;
    }
    if (window.API) {
      window.API.download.openFile(filePath).catch(() => {});
    }
  }, []);

  /** 在文件夹中显示文件 */
  const openDir = useCallback((filePath: string) => {
    if (!filePath) {
      toast.error('文件路径无效');
      return;
    }
    if (window.API) {
      window.API.download.openDir(filePath).catch(() => {});
    }
  }, []);

  /** 批量暂停所有下载中的任务：从 tasksRef 读取状态，副作用在 updater 外执行 */
  const pauseAll = useCallback(() => {
    const downloading = tasksRef.current.filter((t) => t.status === 'downloading');
    if (downloading.length === 0) {
      toast.info('没有正在下载的任务');
      return;
    }
    downloading.forEach((t) => {
      window.API?.download.pauseTask(t.id).catch(() => {});
    });
    toast.success(`已暂停 ${downloading.length} 个任务`);
    setTasks((prev) =>
      prev.map((t) =>
        t.status === 'downloading' ? { ...t, status: 'paused' as const } : t
      )
    );
  }, []);

  /** 批量恢复所有已暂停/等待中的任务 */
  const resumeAll = useCallback(() => {
    const paused = tasksRef.current.filter((t) => t.status === 'paused' || t.status === 'pending');
    if (paused.length === 0) {
      toast.info('没有可恢复的任务');
      return;
    }
    paused.forEach((t) => {
      window.API?.download.resumeTask(t.id).catch(() => {});
    });
    toast.success(`已恢复 ${paused.length} 个任务`);
    setTasks((prev) =>
      prev.map((t) =>
        t.status === 'paused' || t.status === 'pending'
          ? { ...t, status: 'downloading' as const }
          : t
      )
    );
  }, []);

  /** 批量重试所有失败的任务 */
  const retryAllFailed = useCallback(() => {
    const failed = tasksRef.current.filter((t) => t.status === 'failed');
    if (failed.length === 0) {
      toast.info('没有失败的任务');
      return;
    }
    failed.forEach((t) => {
      window.API?.download.retryTask(t.id).catch(() => {});
    });
    toast.success(`已重试 ${failed.length} 个任务`);
  }, []);

  /** 清空所有已完成的任务（保留文件，仅从列表移除） */
  const clearCompleted = useCallback(() => {
    const completed = tasksRef.current.filter((t) => t.status === 'completed');
    if (completed.length === 0) {
      toast.info('没有已完成的任务');
      return;
    }
    completed.forEach((t) => {
      window.API?.download.cancelTask(t.id, false).catch(() => {});
    });
    toast.success(`已清空 ${completed.length} 个已完成任务`);
    setTasks((prev) => prev.filter((t) => t.status !== 'completed'));
  }, []);

  /** 清空所有失败的任务（保留文件，仅从列表移除） */
  const clearFailed = useCallback(() => {
    const failed = tasksRef.current.filter((t) => t.status === 'failed');
    if (failed.length === 0) {
      toast.info('没有失败的任务');
      return;
    }
    failed.forEach((t) => {
      window.API?.download.cancelTask(t.id, false).catch(() => {});
    });
    toast.success(`已清空 ${failed.length} 个失败任务`);
    setTasks((prev) => prev.filter((t) => t.status !== 'failed'));
  }, []);

  const value = useMemo<DownloadsContextType>(() => ({
    tasks,
    addTask,
    addBatchTasks,
    removeTask,
    toggleStatus,
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
  }), [tasks, addTask, addBatchTasks, removeTask, toggleStatus, retryTask, playTask, openFile, openDir, selectDownloadDir, pauseAll, resumeAll, retryAllFailed, clearCompleted, clearFailed]);

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  );
};

export const useDownloads = (): DownloadsContextType => {
  const context = useContext(DownloadsContext);
  if (!context) throw new Error('useDownloads must be used within DownloadsProvider');
  return context;
};
