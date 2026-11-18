import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FolderOpen, Trash2, Settings, Palette, Play, Cpu, Database, Wifi, Download, AlertTriangle, HardDriveDownload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';
import { PlayerSettings } from '@/components/settings/PlayerSettings';
import { BackupSettings } from '@/components/settings/BackupSettings';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** 左侧索引导航项（含图标与描述） */
const SETTING_SECTIONS = [
  { id: 'basic', label: '基础设置', desc: '更新、源订阅', Icon: Settings },
  { id: 'ui', label: '界面设置', desc: '主题、语言', Icon: Palette },
  { id: 'download', label: '下载设置', desc: '目录、并发', Icon: Download },
  { id: 'player', label: '播放设置', desc: '播放器行为', Icon: Play },
  { id: 'hls', label: 'HLS 配置', desc: '缓冲、解码', Icon: Cpu },
  { id: 'cache', label: '缓存设置', desc: '缓存策略', Icon: Database },
  { id: 'network', label: '网络设置', desc: '超时、重试', Icon: Wifi },
  { id: 'backup', label: '备份设置', desc: '导入导出、云备份', Icon: HardDriveDownload },
] as const;

export const SystemSettings: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState('ask');
  const [downloadDir, setDownloadDir] = useState('');
  const [downloadMethod, setDownloadMethod] = useState('ffmpeg');
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(0);
  const [maxConcurrentSegments, setMaxConcurrentSegments] = useState(0);
  const [autoSubscribe, setAutoSubscribe] = useState(false);
  const [iptvAutoSubscribe, setIptvAutoSubscribe] = useState(false);
  const [autoCheck, setAutoCheck] = useState(false);
  const [autoCheckIntervalHours, setAutoCheckIntervalHours] = useState(6);
  const [language, setLanguage] = useState('zh-CN');
  const [pageSize, setPageSize] = useState(20);
  const [showAdult, setShowAdult] = useState(false);
  const [homeCategoryCount, setHomeCategoryCount] = useState(8);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheExpireHours, setCacheExpireHours] = useState(24);
  const [cacheMaxSizeMB, setCacheMaxSizeMB] = useState(100);
  const [timeoutSeconds, setTimeoutSeconds] = useState(10);
  const [retryCount, setRetryCount] = useState(3);
  const [retryDelaySeconds, setRetryDelaySeconds] = useState(1);
  /** FFmpeg 可用性状态：null=未检测，true=可用，false=不可用 */
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  /** FFmpeg 期望路径（用于提示） */
  const [ffmpegPath, setFfmpegPath] = useState<string>('');
  /** TMDB API Key（用于信息补充，为空则不启用） */
  const [tmdbKey, setTmdbKey] = useState<string>('');
  /** 全局 User-Agent（为空则使用默认） */
  const [userAgent, setUserAgent] = useState<string>('');
  /** 是否启用代理 */
  const [proxyEnabled, setProxyEnabled] = useState(false);
  /** 代理主机 */
  const [proxyHost, setProxyHost] = useState<string>('');
  /** 代理端口 */
  const [proxyPort, setProxyPort] = useState<string>('');
  /** 代理用户名 */
  const [proxyUsername, setProxyUsername] = useState<string>('');
  /** 代理密码 */
  const [proxyPassword, setProxyPassword] = useState<string>('');

  const updateSetting = useCallback((key: string, value: unknown) => {
    window.API?.settings?.set?.(key, value);
  }, []);

  /**
   * 检测 FFmpeg 可用性并更新状态
   * @param {boolean} [showToast=false] - 是否在不可用时弹出 toast 提示
   * @returns {Promise<void>}
   */
  const checkFfmpegAvailability = useCallback(async (showToast = false) => {
    try {
      const result = await window.API?.download?.checkFfmpeg?.();
      const available = !!(result?.success && result.data?.available);
      setFfmpegAvailable(available);
      setFfmpegPath(result?.data?.path || '');
      if (!available && showToast) {
        toast.warning(`未检测到 FFmpeg，将使用分片下载作为备选。期望路径：${result?.data?.path || ''}`);
      }
    } catch {
      setFfmpegAvailable(null);
      if (showToast) toast.warning('无法检测 FFmpeg 状态，若 FFmpeg 不可用将自动切换为分片下载');
    }
  }, []);

  useEffect(() => {
    if (!window.API?.settings?.getAll) return;
    window.API.settings.getAll().then((data: unknown) => {
      const settings = (data || {}) as Record<string, unknown>;
      const app = (settings.app as Record<string, unknown>) || {};
      const ui = (settings.ui as Record<string, unknown>) || {};
      const dl = (settings.download as Record<string, unknown>) || {};
      const src = (settings.source as Record<string, unknown>) || {};
      const cache = (settings.cache as Record<string, unknown>) || {};
      const network = (settings.network as Record<string, unknown>) || {};
      const mediaInfo = (settings.mediaInfo as Record<string, unknown>) || {};
      const iptv = (settings.iptv as Record<string, unknown>) || {};

      if (app.autoUpdate !== undefined) setAutoUpdate(app.autoUpdate as boolean);
      if (app.startupBehavior !== undefined) {
        setStartupEnabled(app.startupBehavior === 'enabled' || app.startupBehavior === true);
      }
      if (app.closeBehavior) setCloseBehavior(app.closeBehavior as string);
      if (app.download) setDownloadDir(app.download as string);
      if (app.downloadMethod) setDownloadMethod(app.downloadMethod as string);
      if (app.language) setLanguage(app.language as string);
      if (dl.maxConcurrentTasks !== undefined) setMaxConcurrentTasks(dl.maxConcurrentTasks as number);
      if (dl.maxConcurrentSegments !== undefined) setMaxConcurrentSegments(dl.maxConcurrentSegments as number);
      if (src.autoSubscribe !== undefined) setAutoSubscribe(src.autoSubscribe as boolean);
      if (iptv.autoSubscribe !== undefined) setIptvAutoSubscribe(iptv.autoSubscribe as boolean);
      if (src.autoCheck !== undefined) setAutoCheck(src.autoCheck as boolean);
      if (src.autoCheckIntervalHours) setAutoCheckIntervalHours(src.autoCheckIntervalHours as number);
      if (ui.pageSize) setPageSize(ui.pageSize as number);
      if (ui.showAdult !== undefined) setShowAdult(ui.showAdult as boolean);
      if (ui.homeCategoryCount !== undefined) setHomeCategoryCount(ui.homeCategoryCount as number);
      if (cache.enabled !== undefined) setCacheEnabled(cache.enabled as boolean);
      if (cache.expireTime) setCacheExpireHours(Math.round((cache.expireTime as number) / 60 / 60 / 1000));
      if (cache.maxSize) setCacheMaxSizeMB(Math.round((cache.maxSize as number) / 1024 / 1024));
      if (network.timeout) setTimeoutSeconds(Math.round((network.timeout as number) / 1000));
      if (network.retryCount) setRetryCount(network.retryCount as number);
      if (network.retryDelay) setRetryDelaySeconds(Math.round((network.retryDelay as number) / 1000));
      if (network.userAgent !== undefined) setUserAgent(network.userAgent as string);
      const proxy = (network.proxy as Record<string, unknown>) || {};
      if (proxy.enabled !== undefined) setProxyEnabled(proxy.enabled as boolean);
      if (proxy.host !== undefined) setProxyHost(proxy.host as string);
      if (proxy.port !== undefined) setProxyPort(proxy.port ? String(proxy.port) : '');
      if (proxy.username !== undefined) setProxyUsername(proxy.username as string);
      if (proxy.password !== undefined) setProxyPassword(proxy.password as string);
      if (mediaInfo.tmdbKey !== undefined) setTmdbKey(mediaInfo.tmdbKey as string);

      // 若已选择 ffmpeg 下载方式，自动检测可用性
      if (app.downloadMethod === 'ffmpeg') {
        checkFfmpegAvailability();
      }
    });
  }, [checkFfmpegAvailability]);

  /**
   * 保存代理配置到设置
   * @param {Partial<{enabled: boolean, host: string, port: number, username: string, password: string}>} patch - 待合并的代理字段
   */
  const saveProxy = useCallback((patch: Record<string, unknown>) => {
    const merged = {
      enabled: proxyEnabled,
      host: proxyHost,
      port: Number(proxyPort) || 0,
      username: proxyUsername,
      password: proxyPassword,
      ...patch,
    };
    updateSetting('network.proxy', merged);
  }, [proxyEnabled, proxyHost, proxyPort, proxyUsername, proxyPassword, updateSetting]);

  const clearCache = async () => {
    try {
      await window.API?.video?.clearCache?.();
      toast.success('缓存已清空');
    } catch (err) {
      toast.error('清除缓存失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  const selectDownloadDir = async () => {
    try {
      const result = await window.API?.download?.selectDownloadDir?.();
      if (result?.success && result.data) {
        setDownloadDir(result.data);
        updateSetting('app.download', result.data);
      }
    } catch (err) {
      toast.error('选择目录失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  const [activeSection, setActiveSection] = useState<string>('basic');

  /** 点击左侧索引时滚动到对应区块 */
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
    }
  }, []);

  /** 使用 IntersectionObserver 跟踪当前可见的区块，高亮左侧对应索引 */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -60% 0px' }
    );
    SETTING_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex gap-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* 左侧索引导航 */}
      <nav className="w-48 shrink-0 hidden md:block">
        <div className="sticky top-4 space-y-1">
          {SETTING_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                activeSection === s.id
                  ? 'bg-brand/10 text-brand font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>
      {/* 右侧设置内容 */}
      <div className="flex-1 min-w-0 max-w-2xl space-y-8">
      {/* 基础设置 */}
      <div id="basic" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">基础设置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>自动更新</Label>
              <p className="text-xs text-muted-foreground">应用启动时自动检查新版本</p>
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={(v) => {
                setAutoUpdate(v);
                updateSetting('app.autoUpdate', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>开机自启</Label>
              <p className="text-xs text-muted-foreground">系统启动时自动打开应用</p>
            </div>
            <Switch
              checked={startupEnabled}
              onCheckedChange={(v) => {
                setStartupEnabled(v);
                updateSetting('app.startupBehavior', v ? 'enabled' : 'disabled');
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>关闭行为</Label>
            <Select
              value={closeBehavior}
              onValueChange={(v) => {
                setCloseBehavior(v);
                updateSetting('app.closeBehavior', v);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">每次询问</SelectItem>
                <SelectItem value="tray">最小化到托盘</SelectItem>
                <SelectItem value="exit">直接退出</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置关闭窗口时的默认行为</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>源自动订阅</Label>
              <p className="text-xs text-muted-foreground">开启后每次启动延迟 1 分钟自动订阅，当天已订阅则跳过</p>
            </div>
            <Switch
              checked={autoSubscribe}
              onCheckedChange={(v) => {
                setAutoSubscribe(v);
                updateSetting('source.autoSubscribe', v);
                if (v) toast.info('已开启自动订阅，将在下次启动后 1 分钟执行');
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>IPTV 自动订阅</Label>
              <p className="text-xs text-muted-foreground">开启后每次启动延迟 1 分钟自动更新电视直播订阅，当天已订阅则跳过</p>
            </div>
            <Switch
              checked={iptvAutoSubscribe}
              onCheckedChange={(v) => {
                setIptvAutoSubscribe(v);
                updateSetting('iptv.autoSubscribe', v);
                if (v) toast.info('已开启 IPTV 自动订阅，将在下次启动后 1 分钟执行');
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>源自动检查</Label>
              <p className="text-xs text-muted-foreground">开启后按设定间隔自动测试所有源</p>
            </div>
            <Switch
              checked={autoCheck}
              onCheckedChange={(v) => {
                setAutoCheck(v);
                updateSetting('source.autoCheck', v);
              }}
            />
          </div>

          {autoCheck && (
            <div className="space-y-2">
              <Label>检查间隔</Label>
              <Select
                value={String(autoCheckIntervalHours)}
                onValueChange={(v) => {
                  const num = Number(v);
                  setAutoCheckIntervalHours(num);
                  updateSetting('source.autoCheckIntervalHours', num);
                }}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 小时</SelectItem>
                  <SelectItem value="3">3 小时</SelectItem>
                  <SelectItem value="6">6 小时</SelectItem>
                  <SelectItem value="12">12 小时</SelectItem>
                  <SelectItem value="24">24 小时</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">自动测试所有源的间隔时间（重启后生效）</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>TMDB API Key</Label>
            <input
              type="password"
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              onBlur={() => updateSetting('mediaInfo.tmdbKey', tmdbKey)}
              placeholder="填写后启用影视信息补充（留空则关闭）"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">
              用于详情页的影视信息补充（封面、简介、演职员等）。未填写时信息补充功能不启用，直接返回空。可在 themoviedb.org 申请。
            </p>
          </div>
        </div>
      </div>

      {/* 界面设置 */}
      <div id="ui" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">界面设置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="space-y-2">
            <Label>主题</Label>
            <Select
              value={theme}
              onValueChange={(v) => {
                setTheme(v as 'light' | 'dark' | 'system');
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">浅色</SelectItem>
                <SelectItem value="dark">深色</SelectItem>
                <SelectItem value="system">跟随系统</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">选择应用的主题颜色</p>
          </div>

          <div className="space-y-2">
            <Label>语言</Label>
            <Select
              value={language}
              onValueChange={(v) => {
                setLanguage(v);
                updateSetting('app.language', v);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置应用界面语言（重启后生效）</p>
          </div>

          <div className="space-y-2">
            <Label>每页显示数量</Label>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                const num = Number(v);
                setPageSize(num);
                updateSetting('ui.pageSize', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置列表页每页显示的视频数量</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>显示成人内容</Label>
              <p className="text-xs text-muted-foreground">在分类和搜索结果中显示成人内容</p>
            </div>
            <Switch
              checked={showAdult}
              onCheckedChange={async (v) => {
                setShowAdult(v);
                // 等待后端保存设置后再派发事件，确保 Sidebar 重新加载时读到新值
                await window.API?.settings?.set?.('ui.showAdult', v);
                window.dispatchEvent(new CustomEvent('settings:changed', { detail: { key: 'ui.showAdult' } }));
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>首页分类显示条数</Label>
              <p className="text-xs text-muted-foreground">首页每个分类横向显示的视频数量（4-20）</p>
            </div>
            <input
              type="number"
              min={4}
              max={20}
              value={homeCategoryCount}
              onChange={(e) => {
                const v = Math.max(4, Math.min(20, Number(e.target.value) || 8));
                setHomeCategoryCount(v);
                updateSetting('ui.homeCategoryCount', v);
              }}
              className="h-9 w-20 rounded-lg border border-input bg-background px-3 text-sm text-center outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
        </div>
      </div>

      {/* 下载设置 */}
      <div id="download" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">下载设置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="space-y-2">
            <Label>下载目录</Label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={downloadDir}
                readOnly
                placeholder="选择下载目录"
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={selectDownloadDir}>
                <FolderOpen className="w-4 h-4" /> 浏览
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">设置视频下载的默认目录</p>
          </div>

          <div className="space-y-2">
            <Label>下载方式</Label>
            <Select
              value={downloadMethod}
              onValueChange={(v) => {
                setDownloadMethod(v);
                updateSetting('app.downloadMethod', v);
                if (v === 'ffmpeg') {
                  checkFfmpegAvailability(true);
                } else {
                  setFfmpegAvailable(null);
                }
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ffmpeg">FFmpeg下载</SelectItem>
                <SelectItem value="segment">分片下载</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">选择视频下载方式</p>
            {downloadMethod === 'ffmpeg' && ffmpegAvailable === false && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">未检测到 FFmpeg</p>
                  <p className="text-amber-600/80 dark:text-amber-400/80">
                    FFmpeg 不可用，下载时将自动回退为分片下载方式。期望路径：{ffmpegPath || '未知'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>最大同时下载任务数</Label>
            <Select
              value={String(maxConcurrentTasks)}
              onValueChange={(v) => {
                const num = Number(v);
                setMaxConcurrentTasks(num);
                updateSetting('download.maxConcurrentTasks', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">自动（按 CPU 核心数）</SelectItem>
                <SelectItem value="1">1 个</SelectItem>
                <SelectItem value="2">2 个</SelectItem>
                <SelectItem value="3">3 个</SelectItem>
                <SelectItem value="5">5 个</SelectItem>
                <SelectItem value="8">8 个</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">同时下载的任务数量，自动模式根据设备 CPU 核心数调整（重启后生效）</p>
          </div>

          <div className="space-y-2">
            <Label>单任务分片并发数</Label>
            <Select
              value={String(maxConcurrentSegments)}
              onValueChange={(v) => {
                const num = Number(v);
                setMaxConcurrentSegments(num);
                updateSetting('download.maxConcurrentSegments', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">自动（按 CPU 核心数）</SelectItem>
                <SelectItem value="2">2 个</SelectItem>
                <SelectItem value="3">3 个</SelectItem>
                <SelectItem value="5">5 个</SelectItem>
                <SelectItem value="8">8 个</SelectItem>
                <SelectItem value="10">10 个</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">单个下载任务同时下载的分片数量，自动模式根据设备 CPU 核心数调整（重启后生效）</p>
          </div>
        </div>
      </div>

      {/* 播放设置 + HLS 配置（来自 PlayerSettings 组件） */}
      <PlayerSettings />

      {/* 缓存设置 */}
      <div id="cache" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">缓存设置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>启用缓存</Label>
              <p className="text-xs text-muted-foreground">启用后可以提高加载速度</p>
            </div>
            <Switch
              checked={cacheEnabled}
              onCheckedChange={(v) => {
                setCacheEnabled(v);
                updateSetting('cache.enabled', v);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>缓存过期时间</Label>
            <Select
              value={String(cacheExpireHours)}
              onValueChange={(v) => {
                const hours = Number(v);
                setCacheExpireHours(hours);
                updateSetting('cache.expireTime', hours * 60 * 60 * 1000);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1小时</SelectItem>
                <SelectItem value="6">6小时</SelectItem>
                <SelectItem value="24">24小时</SelectItem>
                <SelectItem value="48">48小时</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置缓存数据的过期时间</p>
          </div>

          <div className="space-y-2">
            <Label>缓存大小限制</Label>
            <Select
              value={String(cacheMaxSizeMB)}
              onValueChange={(v) => {
                const mb = Number(v);
                setCacheMaxSizeMB(mb);
                updateSetting('cache.maxSize', mb * 1024 * 1024);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50MB</SelectItem>
                <SelectItem value="100">100MB</SelectItem>
                <SelectItem value="200">200MB</SelectItem>
                <SelectItem value="500">500MB</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置缓存数据的最大大小</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>清除缓存</Label>
              <p className="text-xs text-muted-foreground">清空已下载的临时文件</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={clearCache}>
              <Trash2 className="w-4 h-4" /> 清除
            </Button>
          </div>
        </div>
      </div>

      {/* 网络设置 */}
      <div id="network" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">网络设置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="space-y-2">
            <Label>请求超时</Label>
            <Select
              value={String(timeoutSeconds)}
              onValueChange={(v) => {
                const sec = Number(v);
                setTimeoutSeconds(sec);
                updateSetting('network.timeout', sec * 1000);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5秒</SelectItem>
                <SelectItem value="10">10秒</SelectItem>
                <SelectItem value="15">15秒</SelectItem>
                <SelectItem value="30">30秒</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置网络请求的超时时间</p>
          </div>

          <div className="space-y-2">
            <Label>重试次数</Label>
            <Select
              value={String(retryCount)}
              onValueChange={(v) => {
                const num = Number(v);
                setRetryCount(num);
                updateSetting('network.retryCount', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1次</SelectItem>
                <SelectItem value="3">3次</SelectItem>
                <SelectItem value="5">5次</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置请求失败时的重试次数</p>
          </div>

          <div className="space-y-2">
            <Label>重试延迟</Label>
            <Select
              value={String(retryDelaySeconds)}
              onValueChange={(v) => {
                const sec = Number(v);
                setRetryDelaySeconds(sec);
                updateSetting('network.retryDelay', sec * 1000);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0.5秒</SelectItem>
                <SelectItem value="1">1秒</SelectItem>
                <SelectItem value="2">2秒</SelectItem>
                <SelectItem value="5">5秒</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置重试之间的延迟时间</p>
          </div>

          <div className="space-y-2">
            <Label>User-Agent</Label>
            <input
              type="text"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              onBlur={() => updateSetting('network.userAgent', userAgent)}
              placeholder="留空使用默认 UA，填写后全局生效"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">自定义全局 User-Agent，应用于视频源请求与下载（重启后完全生效）</p>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>启用代理</Label>
                <p className="text-xs text-muted-foreground">开启后全局网络访问（源请求、下载）将通过代理</p>
              </div>
              <Switch
                checked={proxyEnabled}
                onCheckedChange={(v) => {
                  setProxyEnabled(v);
                  saveProxy({ enabled: v });
                }}
              />
            </div>

            {proxyEnabled && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">代理地址</Label>
                    <input
                      type="text"
                      value={proxyHost}
                      onChange={(e) => setProxyHost(e.target.value)}
                      onBlur={() => saveProxy({ host: proxyHost })}
                      placeholder="127.0.0.1"
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">端口</Label>
                    <input
                      type="number"
                      value={proxyPort}
                      onChange={(e) => setProxyPort(e.target.value)}
                      onBlur={() => saveProxy({ port: Number(proxyPort) || 0 })}
                      placeholder="7890"
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">用户名（可选）</Label>
                    <input
                      type="text"
                      value={proxyUsername}
                      onChange={(e) => setProxyUsername(e.target.value)}
                      onBlur={() => saveProxy({ username: proxyUsername })}
                      placeholder="无需认证留空"
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">密码（可选）</Label>
                    <input
                      type="password"
                      value={proxyPassword}
                      onChange={(e) => setProxyPassword(e.target.value)}
                      onBlur={() => saveProxy({ password: proxyPassword })}
                      placeholder="无需认证留空"
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 备份设置 */}
      <div id="backup" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">备份设置</h3>
        <BackupSettings />
      </div>
      </div>
    </div>
  );
};
