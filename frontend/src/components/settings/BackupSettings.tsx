import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDriveDownload,
  Upload,
  Download,
  Trash2,
  Plus,
  Cloud,
  CloudUpload,
  Plug,
  Loader2,
  Database,
  Settings as SettingsIcon,
  History,
  Heart,
} from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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

/** 可备份的数据类型定义 */
const DATA_TYPES: { key: string; label: string; desc: string; Icon: typeof Database }[] = [
  { key: 'settings', label: '设置数据', desc: '应用配置、偏好', Icon: SettingsIcon },
  { key: 'sources', label: '源数据', desc: '视频源列表', Icon: Database },
  { key: 'history', label: '历史数据', desc: '播放历史记录', Icon: History },
  { key: 'favorites', label: '收藏数据', desc: '收藏的视频', Icon: Heart },
];

/** 本地备份记录 */
interface LocalBackupRecord {
  id: string;
  fileName: string;
  dataTypes: string[];
  createdAt: string;
  size: number;
  source: string;
}

/** WebDAV 备份记录 */
interface WebDAVBackupRecord {
  id: string;
  fileName: string;
  size: number;
  lastModified: string;
  source: string;
}

/** WebDAV 配置 */
interface WebDAVConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  basePath: string;
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小字符串
 */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * 格式化时间戳为本地时间字符串
 * @param {string} iso - ISO 时间字符串
 * @returns {string} 格式化后的时间
 */
function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

export const BackupSettings: React.FC = () => {
  /** 选中的数据类型 */
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['settings', 'sources']);
  /** 本地备份列表 */
  const [localBackups, setLocalBackups] = useState<LocalBackupRecord[]>([]);
  /** WebDAV 备份列表 */
  const [webdavBackups, setWebdavBackups] = useState<WebDAVBackupRecord[]>([]);
  /** WebDAV 配置 */
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>({
    enabled: false,
    url: '',
    username: '',
    password: '',
    basePath: '/videoApp-backups/',
  });
  /** 操作中状态标记 */
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  /** WebDAV 测试状态 */
  const [testing, setTesting] = useState(false);
  /** 导入前确认对话框 */
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  /** 导入成功后重启提示对话框（仅可确认） */
  const [restartOpen, setRestartOpen] = useState(false);

  /** 加载本地备份列表 */
  const loadLocalBackups = useCallback(async () => {
    try {
      const result = await window.API?.backup?.getLocalList?.();
      if (result?.success) setLocalBackups(result.data || []);
    } catch { /* 忽略 */ }
  }, []);

  /** 加载 WebDAV 配置 */
  const loadWebDAVConfig = useCallback(async () => {
    try {
      const result = await window.API?.backup?.getWebDAVConfig?.();
      if (result?.success && result.data) setWebdavConfig(result.data);
    } catch { /* 忽略 */ }
  }, []);

  /** 加载 WebDAV 备份列表 */
  const loadWebDAVBackups = useCallback(async () => {
    try {
      const result = await window.API?.backup?.listWebDAV?.();
      if (result?.success) setWebdavBackups(result.data || []);
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    loadLocalBackups();
    loadWebDAVConfig();
  }, [loadLocalBackups, loadWebDAVConfig]);

  /** 切换数据类型选中状态 */
  const toggleType = (key: string): void => {
    setSelectedTypes((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
    );
  };

  /** 设置 loading 标记 */
  const setBusy = (key: string, busy: boolean): void => {
    setLoading((prev) => ({ ...prev, [key]: busy }));
  };

  /** 导出到文件 */
  const handleExport = async (): Promise<void> => {
    if (selectedTypes.length === 0) { toast.warning('请至少选择一种数据类型'); return; }
    setBusy('export', true);
    try {
      const result = await window.API?.backup?.exportToFile?.(selectedTypes);
      if (result?.success) toast.success('已导出备份文件');
      else if (result?.error !== '用户取消') toast.error('导出失败：' + (result?.error || '未知错误'));
    } catch (err) {
      toast.error('导出失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setBusy('export', false);
    }
  };

  /** 从文件导入：先弹出确认对话框提示风险，用户确认后再选择文件 */
  const handleImport = (): void => {
    if (selectedTypes.length === 0) {
      toast.warning('请至少选择一种数据类型');
      return;
    }
    setImportConfirmOpen(true);
  };

  /** 确认导入后执行实际导入流程：选择文件 → 成功提示重启 → 失败提示错误 */
  const confirmImport = async (): Promise<void> => {
    setImportConfirmOpen(false);
    setBusy('import', true);
    try {
      const result = await window.API?.backup?.importFromFile?.(selectedTypes);
      if (result?.success) {
        const types = result.data?.restored || [];
        toast.success(`导入成功，已恢复 ${types.length} 项数据`);
        setRestartOpen(true);
      } else if (result?.error !== '用户取消') {
        toast.error('导入失败：' + (result?.error || '未知错误'));
      }
    } catch (err) {
      toast.error('导入失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setBusy('import', false);
    }
  };

  /** 导入成功后重启应用 */
  const handleRestart = async (): Promise<void> => {
    setRestartOpen(false);
    try {
      await window.API?.app?.restart?.();
    } catch (err) {
      toast.error('重启失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  /** 创建本地备份 */
  const handleCreateLocal = async (): Promise<void> => {
    if (selectedTypes.length === 0) { toast.warning('请至少选择一种数据类型'); return; }
    setBusy('createLocal', true);
    try {
      const result = await window.API?.backup?.createLocal?.(selectedTypes);
      if (result?.success) {
        toast.success('本地备份已创建');
        await loadLocalBackups();
      } else {
        toast.error('创建备份失败：' + (result?.error || '未知错误'));
      }
    } catch (err) {
      toast.error('创建备份失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setBusy('createLocal', false);
    }
  };

  /** 下载本地备份 */
  const handleDownloadLocal = async (id: string): Promise<void> => {
    setBusy(`dl_${id}`, true);
    try {
      const result = await window.API?.backup?.downloadLocal?.(id);
      if (result?.success) toast.success('备份已下载');
      else if (result?.error !== '用户取消') toast.error('下载失败：' + (result?.error || '未知错误'));
    } catch {
      toast.error('下载失败');
    } finally {
      setBusy(`dl_${id}`, false);
    }
  };

  /** 删除本地备份 */
  const handleDeleteLocal = async (id: string): Promise<void> => {
    try {
      const result = await window.API?.backup?.deleteLocal?.(id);
      if (result?.success) {
        toast.success('已删除备份');
        await loadLocalBackups();
      } else {
        toast.error('删除失败：' + (result?.error || '未知错误'));
      }
    } catch {
      toast.error('删除失败');
    }
  };

  /** 保存 WebDAV 配置 */
  const saveWebDAVConfig = useCallback(async (patch: Partial<WebDAVConfig>): Promise<void> => {
    const merged = { ...webdavConfig, ...patch };
    setWebdavConfig(merged);
    await window.API?.backup?.setWebDAVConfig?.(merged);
  }, [webdavConfig]);

  /** 测试 WebDAV 连接 */
  const handleTestWebDAV = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await window.API?.backup?.testWebDAV?.(webdavConfig);
      if (result?.success) toast.success('WebDAV 连接成功');
      else toast.error('连接失败：' + (result?.error || '未知错误'));
    } catch {
      toast.error('连接失败');
    } finally {
      setTesting(false);
    }
  };

  /** 上传备份到 WebDAV */
  const handleUploadWebDAV = async (): Promise<void> => {
    if (selectedTypes.length === 0) { toast.warning('请至少选择一种数据类型'); return; }
    if (!webdavConfig.url) { toast.warning('请先填写 WebDAV 地址'); return; }
    setBusy('upload', true);
    try {
      const result = await window.API?.backup?.uploadToWebDAV?.(selectedTypes);
      if (result?.success) {
        toast.success('已上传到云端');
        await loadWebDAVBackups();
      } else {
        toast.error('上传失败：' + (result?.error || '未知错误'));
      }
    } catch (err) {
      toast.error('上传失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setBusy('upload', false);
    }
  };

  /** 从 WebDAV 恢复 */
  const handleDownloadWebDAV = async (fileName: string): Promise<void> => {
    setBusy(`wd_${fileName}`, true);
    try {
      const result = await window.API?.backup?.downloadFromWebDAV?.(fileName, selectedTypes);
      if (result?.success) {
        const types = result.data?.restored || [];
        toast.success(`恢复成功，已恢复 ${types.length} 项数据`);
      } else {
        toast.error('恢复失败：' + (result?.error || '未知错误'));
      }
    } catch {
      toast.error('恢复失败');
    } finally {
      setBusy(`wd_${fileName}`, false);
    }
  };

  /** 删除 WebDAV 备份 */
  const handleDeleteWebDAV = async (fileName: string): Promise<void> => {
    try {
      const result = await window.API?.backup?.deleteFromWebDAV?.(fileName);
      if (result?.success) {
        toast.success('已删除云端备份');
        await loadWebDAVBackups();
      } else {
        toast.error('删除失败：' + (result?.error || '未知错误'));
      }
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <section className="space-y-8">
        {/* 数据选择 */}
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">选择备份数据</h3>
          <div className="rounded-xl bg-card shadow-card p-4 space-y-3">
            {DATA_TYPES.map(({ key, label, desc, Icon }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-brand" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>{label}</Label>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
                <Checkbox
                  checked={selectedTypes.includes(key)}
                  onCheckedChange={() => toggleType(key)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 导入/导出 */}
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">导入 / 导出</h3>
          <div className="rounded-xl bg-card shadow-card p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              将所选数据合并导出为单个 JSON 文件，或从备份文件恢复数据
            </p>
            <div className="flex gap-3">
              <Button
                onClick={handleExport}
                disabled={loading.export || selectedTypes.length === 0}
                variant="outline"
                className="flex-1"
              >
                {loading.export ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                导出文件
              </Button>
              <Button
                onClick={handleImport}
                disabled={loading.import}
                variant="outline"
                className="flex-1"
              >
                {loading.import ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                导入文件
              </Button>
            </div>
          </div>
        </div>

        {/* 本地备份 */}
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">本地备份</h3>
          <div className="rounded-xl bg-card shadow-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>创建备份记录</Label>
                <p className="text-xs text-muted-foreground">将所选数据保存为本地备份记录</p>
              </div>
              <Button
                onClick={handleCreateLocal}
                disabled={loading.createLocal || selectedTypes.length === 0}
                size="sm"
              >
                {loading.createLocal ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-1" />
                )}
                创建备份
              </Button>
            </div>

            {localBackups.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">暂无备份记录</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {localBackups.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium truncate">{record.fileName}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatTime(record.createdAt)}</span>
                        <span>{formatSize(record.size)}</span>
                        <span className="truncate">{record.dataTypes?.join(' / ') || '-'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadLocal(record.id)}
                        disabled={loading[`dl_${record.id}`]}
                        title="下载"
                      >
                        {loading[`dl_${record.id}`] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteLocal(record.id)}
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 云端备份 (WebDAV) */}
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Cloud className="w-4 h-4" />
            云端备份 (WebDAV)
          </h3>
          <div className="rounded-xl bg-card shadow-card p-4 space-y-4">

            {/* 启用开关 */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>启用 WebDAV 云备份</Label>
                <p className="text-xs text-muted-foreground">开启后可备份到 WebDAV 服务器</p>
              </div>
              <Switch
                checked={webdavConfig.enabled}
                onCheckedChange={(v) => saveWebDAVConfig({ enabled: v })}
              />
            </div>

            {/* WebDAV 配置：启用开关打开后才展开，避免未启用时占用视觉空间 */}
            {webdavConfig.enabled && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>WebDAV 地址</Label>
                  <Input
                    placeholder="https://dav.example.com"
                    value={webdavConfig.url}
                    onChange={(e) => setWebdavConfig((prev) => ({ ...prev, url: e.target.value }))}
                    onBlur={(e) => saveWebDAVConfig({ url: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>用户名</Label>
                    <Input
                      placeholder="可选"
                      value={webdavConfig.username}
                      onChange={(e) => setWebdavConfig((prev) => ({ ...prev, username: e.target.value }))}
                      onBlur={(e) => saveWebDAVConfig({ username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>密码</Label>
                    <Input
                      type="password"
                      placeholder="可选"
                      value={webdavConfig.password}
                      onChange={(e) => setWebdavConfig((prev) => ({ ...prev, password: e.target.value }))}
                      onBlur={(e) => saveWebDAVConfig({ password: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>备份目录路径</Label>
                  <Input
                    placeholder="/videoApp-backups/"
                    value={webdavConfig.basePath}
                    onChange={(e) => setWebdavConfig((prev) => ({ ...prev, basePath: e.target.value }))}
                    onBlur={(e) => saveWebDAVConfig({ basePath: e.target.value })}
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleTestWebDAV}
                    disabled={testing || !webdavConfig.url}
                    variant="outline"
                    className="flex-1"
                  >
                    {testing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Plug className="w-4 h-4 mr-2" />
                    )}
                    测试连接
                  </Button>
                  <Button
                    onClick={handleUploadWebDAV}
                    disabled={loading.upload || !webdavConfig.url || selectedTypes.length === 0}
                    className="flex-1"
                  >
                    {loading.upload ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CloudUpload className="w-4 h-4 mr-2" />
                    )}
                    上传备份
                  </Button>
                </div>
              </div>
            )}

            {/* WebDAV 备份列表 */}
            {webdavConfig.enabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">云端备份列表</Label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={loadWebDAVBackups}
                    disabled={!webdavConfig.url}
                  >
                    刷新
                  </Button>
                </div>
                {webdavBackups.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    暂无云端备份
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {webdavBackups.map((record) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-medium truncate">{record.fileName}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{formatSize(record.size)}</span>
                            <span>{formatTime(record.lastModified)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDownloadWebDAV(record.fileName)}
                            disabled={loading[`wd_${record.fileName}`]}
                            title="恢复"
                          >
                            {loading[`wd_${record.fileName}`] ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteWebDAV(record.fileName)}
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 导入前确认对话框：提示风险，用户确认后再选择文件 */}
        <AlertDialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认导入备份？</AlertDialogTitle>
              <AlertDialogDescription>
                导入将覆盖当前所选数据类型的现有数据，且不可恢复。请确保备份文件来源可信，避免导入不兼容或损坏的数据。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={confirmImport}>确认导入</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 导入成功后重启提示对话框：仅可确认，无取消按钮 */}
        <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>导入成功，需要重启</AlertDialogTitle>
              <AlertDialogDescription>
                备份数据已成功导入，需要重启应用以使所有变更生效。点击下方按钮立即重启。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={handleRestart}>确认重启</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </section>
  );
};
