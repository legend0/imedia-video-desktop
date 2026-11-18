import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { useSearch } from '@/contexts/SearchContext';
import {
  ChevronLeft,
  Search,
  Bell,
  Moon,
  Sun,
  Settings,
  Minus,
  Maximize2,
  X,
  Menu,
  Database,
  Clock,
  Trash2,
  Loader2,
  Flame,
  Circle,
  Settings2,
  Info,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { useSettingsTab, type SettingsTab } from '@/contexts/SettingsTabContext';
import { useNotifications, type NotificationItem } from '@/contexts/NotificationsContext';
import { toast } from 'sonner';
import { CloseConfirmDialog } from '@/components/CloseConfirmDialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(date).toLocaleDateString('zh-CN');
}

const NOTIFICATION_ICON_MAP = {
  success: <CheckCircle className="w-4 h-4 text-green" />,
  error: <XCircle className="w-4 h-4 text-destructive" />,
  warning: <AlertTriangle className="w-4 h-4 text-orange" />,
  info: <Info className="w-4 h-4 text-blue" />,
};

interface Resource {
  id: string;
  name: string;
  responseTime?: number;
  failed?: boolean;
  isAdult?: boolean;
}

/** 根据响应时间返回颜色类名（与旧项目 PluginWheel 速度颜色一致） */
function getSpeedColorClass(responseTime?: number): string {
  if (responseTime === undefined) return 'bg-muted-foreground';
  if (responseTime < 1000) return 'bg-green';
  if (responseTime < 2000) return 'bg-blue';
  if (responseTime < 3000) return 'bg-orange';
  return 'bg-destructive';
}

interface TitleBarProps {
  onMenuClick?: () => void;
}

const ResourceWheel: React.FC = () => {
  const navigate = useNavigate();
  const [resources, setResources] = useState<Resource[]>([]);
  const [current, setCurrent] = useState<Resource | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartY = useRef(0);
  const dragStartIndex = useRef(0);
  const wheelRef = useRef<HTMLDivElement>(null);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;

  const ITEM_HEIGHT = 32;

  useEffect(() => {
    if (!window.API?.source) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const raw = (await window.API.source.getSourceList()) as Record<
          string,
          {
            name?: string;
            enable?: boolean;
            isActive?: boolean;
            isAdult?: boolean;
            test?: { success?: boolean; responseTime?: number };
          }
        >;
        if (cancelled || !raw) return;
        const showAdultValue = window.API?.settings?.get
          ? await window.API.settings.get('ui.showAdult').catch(() => false)
          : false;
        const showAdult = showAdultValue === true;
        const list: Resource[] = Object.entries(raw)
          .filter(([, src]) => {
            if (src?.enable === false) return false;
            if (src?.test?.success === false) return false;
            if (!showAdult && src?.isAdult) return false;
            return true;
          })
          .map(([key, src]) => ({
            id: key,
            name: src?.name || key,
            responseTime: src?.test?.responseTime,
            failed: src?.test?.success === false,
            isAdult: src?.isAdult === true,
          }));
        if (list.length === 0) {
          setResources([]);
          setCurrent(null);
          setLoading(false);
          return;
        }
        setResources(list);

        const activeSrc = (await window.API.source.getCurrentSource()) as
          | { key?: string; name?: string }
          | null;
        if (cancelled) return;
        const activeId = activeSrc?.key;
        const activeIdx = list.findIndex((r) => r.id === activeId);
        const initialIdx = activeIdx >= 0 ? activeIdx : 0;
        setCurrentIndex(initialIdx);
        setCurrent(list[initialIdx]);
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** 监听源切换和设置变化（如 showAdult 开关），触发源列表重载 */
  useEffect(() => {
    const handler = () => setReloadKey((k) => k + 1);
    window.addEventListener('source:changed', handler);
    window.addEventListener('settings:changed', handler);
    return () => {
      window.removeEventListener('source:changed', handler);
      window.removeEventListener('settings:changed', handler);
    };
  }, []);

  const enter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };

  const leave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  };

  /**
   * 执行实际源切换：调用后端 + 显示提示 + 更新页面数据
   * 点击任意源项时直接触发切换。需等待 setCurrentSource 完成后再派发事件，
   * 确保侧边栏刷新分类时后端已切换到新源。
   * 同源时不执行切换，避免无意义的 toast、事件派发和页面跳转。
   */
  const applySelection = async (idx: number) => {
    if (resources.length === 0) return;
    const next = Math.max(0, Math.min(resources.length - 1, idx));
    const nextResource = resources[next];
    // 同源不处理
    if (current?.id === nextResource.id) {
      setOpen(false);
      return;
    }
    setCurrentIndex(next);
    setCurrent(nextResource);
    try {
      await window.API?.source?.setCurrentSource(nextResource.id);
    } catch {
      // 切换失败仍提示用户，不阻塞 UI
    }
    toast.success(`已切换到源：${nextResource.name}`);
    setOpen(false);
    window.dispatchEvent(new CustomEvent('source:changed'));
    navigate('/');
  };

  /** 滚轮切换：通过原生非 passive 监听器阻止默认滚动并切换源索引 */
  useEffect(() => {
    if (!open) return;
    const el = wheelRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(resources.length - 1, currentIndexRef.current + direction));
      if (nextIdx !== currentIndexRef.current) {
        setCurrentIndex(nextIdx);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [open, resources.length]);

  /** 鼠标按下：开始拖拽，记录起始 Y 和起始索引 */
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!open) return;
    setIsDragging(true);
    setDragOffset(0);
    dragStartY.current = e.clientY;
    dragStartIndex.current = currentIndex;
  };

  /** 全局鼠标移动：跟随鼠标更新 translateY 与临时预览索引 */
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartY.current;
      setDragOffset(deltaY);
      const rawIdx = dragStartIndex.current + Math.round(-deltaY / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(resources.length - 1, rawIdx));
      if (clamped !== currentIndex) {
        setCurrentIndex(clamped);
      }
    };
    const onUp = () => {
      setIsDragging(false);
      setDragOffset(0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, resources.length]);

  /** 点击项：直接切换到所点击的源 */
  const handleClickItem = (index: number) => {
    if (isDragging) return;
    applySelection(index);
  };

  if (loading) {
    return (
      <button
        className="flex items-center gap-2 px-3 h-9 rounded-xl bg-card shadow-md text-sm font-medium"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="hidden sm:inline text-muted-foreground">加载源...</span>
      </button>
    );
  }

  if (resources.length === 0 || !current) {
    return (
      <button
        onClick={() => navigateToSettings()}
        className="flex items-center gap-2 px-3 h-9 rounded-xl bg-card shadow-md hover:shadow-lg hover:bg-muted transition-all text-sm font-medium text-muted-foreground"
      >
        <Database className="w-4 h-4" />
        <span className="hidden sm:inline">未配置源</span>
      </button>
    );
  }

  const translateY = -currentIndex * ITEM_HEIGHT + dragOffset;

  return (
    <div
      className="relative"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button className="flex items-center gap-2 px-3 h-9 rounded-xl bg-card shadow-md hover:shadow-lg hover:bg-muted transition-all text-sm font-medium max-w-[140px]">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', getSpeedColorClass(current.responseTime))} />
        <span className="hidden sm:inline truncate">{current.name}</span>
        {current.isAdult && (
          <AlertTriangle className="w-3 h-3 shrink-0 text-destructive" />
        )}
      </button>

      {open && (
        <div
          ref={wheelRef}
          onMouseEnter={enter}
          onMouseLeave={leave}
          className="absolute right-0 top-full mt-2 w-40 bg-card rounded-xl shadow-lg py-3 origin-top-right animate-in fade-in zoom-in-95 duration-200 overflow-hidden select-none"
        >
          <div className="relative overflow-hidden" style={{ height: 3 * ITEM_HEIGHT }}>
            <div
              className="flex flex-col items-center"
              style={{
                transform: `translateY(${translateY + ITEM_HEIGHT}px)`,
                transition: isDragging
                  ? 'none'
                  : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {resources.map((resource, index) => {
                const distance = Math.abs(index - currentIndex);
                const isCurrent = index === currentIndex;
                return (
                  <button
                    key={resource.id}
                    onMouseDown={handleMouseDown}
                    onClick={() => handleClickItem(index)}
                    style={{ height: ITEM_HEIGHT }}
                    className={cn(
                      'w-full flex items-center justify-center gap-1.5 transition-all',
                      isDragging ? '' : 'duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                      isCurrent
                        ? 'text-sm font-bold text-brand scale-100 opacity-100'
                        : distance === 1
                          ? 'text-xs text-muted-foreground scale-90 opacity-60'
                          : 'text-xs text-muted-foreground scale-75 opacity-0'
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', getSpeedColorClass(resource.responseTime))} />
                    <span className="truncate">{resource.name}</span>
                    {resource.isAdult && (
                      <AlertTriangle className="w-3 h-3 shrink-0 text-destructive" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** 跳转到设置页（ResourceWheel 内部使用） */
function navigateToSettings() {
  // 通过全局事件让主组件导航，避免引入 router 依赖
  window.dispatchEvent(new CustomEvent('titlebar:navigate-settings'));
}

export const TitleBar: React.FC<TitleBarProps> = ({ onMenuClick }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const { theme, toggleTheme } = useTheme();
  const { activeTab, setActiveTab } = useSettingsTab();
  const { notifications, unreadCount, unreadIds, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const isSettingsPage = location.pathname === '/settings';

  /** 全局搜索状态 */
  const { searchKeyword, setSearchKeyword, clearSearch } = useSearch();
  /** 搜索框本地输入值（用于即时编辑，回车/选择后才同步到全局） */
  const [searchValue, setSearchValue] = useState(searchKeyword);
  const [searchFocused, setSearchFocused] = useState(false);

  /** 全局搜索关键词变化时同步本地输入值（避免输入时被覆盖，仅在非聚焦状态下同步） */
  useEffect(() => {
    if (!searchFocused) {
      setSearchValue(searchKeyword);
    }
  }, [searchKeyword, searchFocused]);

  /** 离开搜索/List 页到达非搜索相关页面时清空搜索 */
  useEffect(() => {
    const isSearchRelated = location.pathname === '/search' || location.pathname.startsWith('/list/');
    if (!isSearchRelated) {
      clearSearch();
      setSearchFocused(false);
    }
  }, [location.pathname, clearSearch]);

  const [canGoBack, setCanGoBack] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  /** 当前源是否支持搜索（切换源时更新） */
  const [searchSupported, setSearchSupported] = useState(true);
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(window.localStorage.getItem('movie-island-search-history') || '[]');
    } catch {
      return [];
    }
  });
  /** 热门搜索词列表（来自 video.hotSearch，每项含 title 和 rate） */
  const [hotSearch, setHotSearch] = useState<{ title: string; rate: string }[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  /** 设置页标签配置（与 Settings.tsx 的 tabs 保持一致） */
  const settingsTabs: { key: SettingsTab; label: string; icon: typeof Circle }[] = [
    { key: 'source', label: '源管理', icon: Circle },
    { key: 'system', label: '系统设置', icon: Settings2 },
    { key: 'about', label: '关于应用', icon: Info },
  ];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /** 跟踪导航历史深度：PUSH 前进增加深度，POP 后退减少深度，用于控制返回按钮禁用状态 */
  const historyDepthRef = useRef(0);
  useEffect(() => {
    if (navType === 'PUSH') {
      historyDepthRef.current += 1;
    } else if (navType === 'POP') {
      historyDepthRef.current = Math.max(0, historyDepthRef.current - 1);
    }
    setCanGoBack(historyDepthRef.current > 0);
  }, [navType, location.pathname]);

  /** 监听 ResourceWheel 的导航请求 */
  useEffect(() => {
    const handler = () => navigate('/settings');
    window.addEventListener('titlebar:navigate-settings', handler);
    return () => window.removeEventListener('titlebar:navigate-settings', handler);
  }, [navigate]);

  /** 检查当前源是否支持搜索，并在切换源时更新 */
  useEffect(() => {
    const checkSearchSupport = async () => {
      try {
        const source = await window.API?.source?.getCurrentSource?.();
        setSearchSupported(source?.search !== false);
      } catch {
        setSearchSupported(true);
      }
    };
    checkSearchSupport();
    const handler = () => checkSearchSupport();
    window.addEventListener('source:changed', handler);
    return () => window.removeEventListener('source:changed', handler);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('movie-island-search-history', JSON.stringify(history));
  }, [history]);

  /**
   * 加载热门搜索词（仅加载一次，后端有 24 小时缓存）
   * 失败时静默处理，热搜词区域不显示
   */
  useEffect(() => {
    if (!window.API?.video?.hotSearch) return;
    let cancelled = false;
    window.API.video.hotSearch()
      .then((data: unknown) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data as { title: string; rate: string }[] : [];
        // 按 rate 降序取前 7 个，与旧 demo 行为一致
        const sorted = [...list]
          .sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate))
          .slice(0, 7);
        if (!cancelled) setHotSearch(sorted);
      })
      .catch(() => {
        // 热搜词加载失败不阻塞搜索功能
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveHistory = (q: string) => {
    setHistory((prev) => [q, ...prev.filter((item) => item !== q)].slice(0, 10));
  };

  const handleSearch = () => {
    if (searchValue.trim()) {
      const keyword = searchValue.trim();
      setSearchKeyword(keyword);
      saveHistory(keyword);
      setSearchFocused(false);
      navigate(`/search?q=${encodeURIComponent(keyword)}`);
    }
  };

  const selectHistory = (q: string) => {
    setSearchValue(q);
    setSearchKeyword(q);
    saveHistory(q);
    setSearchFocused(false);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  /**
   * 关闭按钮处理：读取 app.closeBehavior 设置决定行为
   * - ask: 弹出确认对话框
   * - tray: 直接最小化到托盘
   * - exit: 直接退出
   */
  const handleClose = async () => {
    const behavior = (await window.API?.settings?.get?.('app.closeBehavior')) as
      | string
      | undefined;
    if (behavior === 'tray') {
      window.API?.window?.hide();
    } else if (behavior === 'exit') {
      window.API?.window?.close();
    } else {
      setCloseConfirmOpen(true);
    }
  };

  return (
    <header
      className="sticky top-0 z-40 h-16 bg-background shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] flex items-center justify-between px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <button
          onClick={onMenuClick}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button
          onClick={() => navigate(-1)}
          disabled={!canGoBack}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-xl transition-colors',
            canGoBack
              ? 'hover:bg-muted text-muted-foreground'
              : 'text-muted-foreground/30 cursor-not-allowed'
          )}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          className={cn('relative', isSettingsPage ? 'hidden' : 'hidden sm:block')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          ref={searchRef}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            onFocus={() => setSearchFocused(true)}
            disabled={!searchSupported}
            placeholder={searchSupported ? '搜索影视、综艺、动漫...' : '当前源不支持搜索'}
            className={cn(
              'relative h-9 pl-9 pr-9 rounded-xl bg-card text-sm outline-none shadow-md ring-0 transition-[width,box-shadow,opacity] duration-300',
              searchSupported
                ? (searchFocused ? 'w-[300px] shadow-lg' : 'w-[150px]')
                : 'w-[150px] opacity-50 cursor-not-allowed'
            )}
          />
          {searchValue && (
            <button
              onClick={() => {
                setSearchValue('');
                clearSearch();
                // 退出搜索状态：搜索页跳首页，List 页恢复普通模式
                if (location.pathname === '/search') {
                  navigate('/');
                } else if (location.pathname.startsWith('/list/')) {
                  navigate(location.pathname);
                }
              }}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 w-5 h-5 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {searchSupported && searchFocused && (history.length > 0 || hotSearch.length > 0) && (
            <div className="absolute left-0 right-0 top-full mt-2 pt-2 pb-2 bg-card rounded-xl shadow-card z-50 animate-in fade-in slide-in-from-top-2 duration-200 origin-top">
              {history.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">最近搜索</span>
                    </div>
                    <button
                      onClick={() => setHistory([])}
                      onMouseDown={(e) => e.preventDefault()}
                      className="text-xs text-brand hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> 清空
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-3 pb-1">
                    {history.map((q, idx) => (
                      <div
                        key={`${q}-${idx}`}
                        onClick={() => selectHistory(q)}
                        onMouseDown={(e) => e.preventDefault()}
                        className="relative group flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-muted text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                      >
                        <span className="truncate max-w-[120px] pr-3">{q}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistory(history.filter((_, i) => i !== idx));
                          }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-destructive transition-opacity"
                          aria-label={`删除搜索记录 ${q}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {hotSearch.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 mt-1 border-t border-border/50">
                    <Flame className="w-3.5 h-3.5 text-orange" />
                    <span className="text-xs text-muted-foreground">热门搜索</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-3 pb-1">
                    {hotSearch.map((item, idx) => (
                      <button
                        key={`${item.title}-${idx}`}
                        onClick={() => selectHistory(item.title)}
                        onMouseDown={(e) => e.preventDefault()}
                        className={cn(
                          'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors',
                          idx < 3
                            ? 'bg-orange/10 text-orange hover:bg-orange/20'
                            : 'bg-muted text-foreground hover:bg-muted/70'
                        )}
                      >
                        {idx < 3 && <Flame className="w-3 h-3 fill-current" />}
                        <span>{item.title}</span>
                        <span className="text-[10px] opacity-60">{item.rate}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className="flex items-center gap-2 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* 设置页标签：仅在 /settings 路由下显示 */}
        {isSettingsPage && (
          <div className="flex items-center gap-1 mr-2">
            {settingsTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand/10 text-brand'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden lg:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 资源切换：从后端加载真实源列表（设置页隐藏，因源管理已是设置页标签之一） */}
        {!isSettingsPage && <ResourceWheel />}

        <Popover>
          <PopoverTrigger asChild>
            <button className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-destructive rounded-full">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end" sideOffset={4}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">消息通知</h3>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-brand hover:underline"
                  >
                    全部已读
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-destructive hover:underline"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
            <ScrollArea className="h-[320px]">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Bell className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">暂无消息</p>
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {notifications.map((notification) => {
                    const typeBadgeStyle = cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                      notification.type === 'success' && 'bg-green/10 text-green',
                      notification.type === 'error' && 'bg-destructive/10 text-destructive',
                      notification.type === 'warning' && 'bg-orange/10 text-orange',
                      notification.type === 'info' && 'bg-blue/10 text-blue',
                    );
                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          'p-3 rounded-xl cursor-pointer transition-colors',
                          unreadIds.has(notification.id)
                            ? 'bg-brand/5'
                            : 'hover:bg-muted'
                        )}
                        onClick={() => markAsRead(notification.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0">
                            {NOTIFICATION_ICON_MAP[notification.type]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={typeBadgeStyle}>
                                {notification.title}
                              </span>
                              <span className="text-[10px] text-muted-foreground/60 shrink-0">
                                {formatTime(notification.time)}
                              </span>
                            </div>
                            {notification.message && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {notification.message}
                              </p>
                            )}
                          </div>
                          {notification.action && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markAsRead(notification.id);
                                navigate('/downloads');
                              }}
                              className="text-xs text-brand hover:underline shrink-0"
                            >
                              {notification.action.label}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* 设置入口按钮：设置页本身不需要显示 */}
        {!isSettingsPage && (
          <button
            onClick={() => navigate('/settings')}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}

        <div className="w-px h-6 bg-border mx-1" />

        <button
          onClick={() => window.API?.window.minimize()}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors"
        >
          <Minus className="w-5 h-5" />
        </button>
        <button
          onClick={() => window.API?.window.maximize()}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={handleClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-brand/10 text-muted-foreground hover:text-brand transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <CloseConfirmDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen} />
    </header>
  );
};
