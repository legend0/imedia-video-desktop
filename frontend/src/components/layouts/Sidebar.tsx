import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface NavItem {
  key: string;
  label: string;
  /** iconfont SVG sprite 图标名（如 icon-shenghuo） */
  iconName: string;
  path?: string;
}

/** 固定主菜单（首页 + 电视直播，其他分类由后端 API 动态加载） */
const mainMenu: NavItem[] = [
  { key: 'home', label: '首页', iconName: 'icon-shenghuo', path: '/' },
  { key: 'live', label: '电视直播', iconName: 'icon-zhibo', path: '/live' },
];

const bottomMenu: NavItem[] = [
  { key: 'fav', label: '我的收藏', iconName: 'icon-shoucang', path: '/favorites' },
  { key: 'download', label: '下载管理', iconName: 'icon-xiazai', path: '/downloads' },
];

/**
 * 按分类名匹配 iconfont 图标名
 * 优先选用语义贴合的图标（影视/电视剧/综艺/动漫/成人/体育/纪录/其他）
 * @param name - 分类名称
 * @returns iconfont 图标名
 */
function getCategoryIcon(name: string): string {
  const text = name || '';
  const lower = text.toLowerCase();
  if (/电影|movie|film/.test(lower + text)) return 'icon-yingshi';
  if (/电视|tv|剧/.test(lower + text)) return 'icon-dianshiju1';
  if (/综艺|show|variety/.test(lower + text)) return 'icon-huodong';
  if (/动漫|anime|动画/.test(lower + text)) return 'icon-dongman';
  if (/体育|sport|球/.test(lower + text)) return 'icon-tiyu';
  if (/纪录|doc/.test(lower + text)) return 'icon-zixun';
  if (/成人|adult|伦理|三级/.test(lower + text)) return 'icon-anquan';
  return 'icon-ziyuan';
}

interface SidebarProps {
  isSettingsActive?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Logo: React.FC<{ collapsed?: boolean }> = ({ collapsed }) => (
  <div className={cn('flex items-center gap-3 py-5', collapsed ? 'px-3 justify-center' : 'px-4')}>
    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-orange flex items-center justify-center shadow-card shrink-0">
      <img src="./icons/logo.png" alt="logo" className="text-white" />
    </div>
    {!collapsed && (
      <div className="flex flex-col overflow-hidden">
        <span className="text-lg font-bold gradient-text leading-tight whitespace-nowrap">影视岛</span>
        <span className="text-[10px] text-muted-foreground leading-tight whitespace-nowrap">专注于影视资源分享</span>
      </div>
    )}
  </div>
);

const NavButton: React.FC<{
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onClick: () => void;
}> = ({ item, active, collapsed, onClick }) => {
  const content = (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center rounded-xl text-sm font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        collapsed ? 'w-10 h-10 justify-center mx-auto' : 'w-full gap-3 px-3 py-2.5'
      )}
    >
      {active && (
        <div className={cn(
          'absolute bg-brand rounded-r-full',
          collapsed ? 'left-0 w-[3px] h-4 top-1/2 -translate-y-1/2' : '-left-3 w-[3px] h-5 top-1/2 -translate-y-1/2'
        )} />
      )}
      <svg className="icon text-xl shrink-0" aria-hidden="true">
        <use xlinkHref={`#${item.iconName}`} />
      </svg>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return content;
};

const NavContent: React.FC<{
  isSettingsActive?: boolean;
  collapsed?: boolean;
  onItemClick?: () => void;
}> = ({ isSettingsActive, collapsed, onItemClick }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [categoryMenu, setCategoryMenu] = useState<NavItem[]>([]);

  // 记录上一个非详情页路径，用于详情页时保持来源菜单项的选中状态
  const lastNonDetailPath = useRef<string>(location.pathname);
  useEffect(() => {
    if (!location.pathname.startsWith('/detail/')) {
      lastNonDetailPath.current = location.pathname;
    }
  }, [location.pathname]);

  // 详情页时使用来源路径进行 active 判断，其他页面使用当前路径
  const effectivePath = location.pathname.startsWith('/detail/')
    ? lastNonDetailPath.current
    : location.pathname;

  const loadCategories = () => {
    if (!window.API?.video?.getCategories) return;
    let cancelled = false;
    window.API.video.getCategories().then((cats: unknown) => {
      if (cancelled) return;
      const list = Array.isArray(cats) ? (cats as Record<string, unknown>[]) : [];
      const items: NavItem[] = [];
      list.forEach((cat) => {
        const name = (cat.name as string) || '';
        // 优先使用前端 getCategoryIcon 语义映射，后端 icon 作为兜底
        // （后端 categoryFormatter.js 的部分图标语义不合理，如电影→直播、综艺→咖啡）
        const iconName = getCategoryIcon(name) || (cat.icon as string) || 'icon-ziyuan';
        const subcategories = (cat.subcategories as Record<string, unknown>[]) || [];
        const firstSubId = subcategories[0]?.id;
        if (firstSubId) {
          items.push({
            key: `cat-${cat.id ?? name}`,
            label: name,
            iconName,
            path: `/list/${cat.id}`,
          });
        }
      });
      setCategoryMenu(items);
    });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const cleanup = loadCategories();
    const handler = () => loadCategories();
    window.addEventListener('source:changed', handler);
    window.addEventListener('settings:changed', handler);
    return () => {
      if (cleanup) cleanup();
      window.removeEventListener('source:changed', handler);
      window.removeEventListener('settings:changed', handler);
    };
  }, []);

  const handleNav = (path?: string) => {
    onItemClick?.();
    if (path) navigate(path);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className={cn('mb-2', collapsed ? 'text-center' : 'px-5')}>
        <span className="text-xs text-muted-foreground">主菜单</span>
      </div>
      <nav className={cn('space-y-1', collapsed ? 'px-2' : 'px-3')}>
        {mainMenu.map((item) => {
          const active = item.path === '/'
            ? (effectivePath === '/' || isSettingsActive)
            : effectivePath.startsWith(item.path || '');
          return (
            <NavButton
              key={item.key}
              item={item}
              active={!!active}
              collapsed={collapsed}
              onClick={() => handleNav(item.path)}
            />
          );
        })}
      </nav>

      {categoryMenu.length > 0 && (
        <>
          <div className={cn('mt-4 mb-2', collapsed ? 'text-center' : 'px-5')}>
            <span className="text-xs text-muted-foreground">分类</span>
          </div>
          <nav className={cn('space-y-1', collapsed ? 'px-2' : 'px-3')}>
            {categoryMenu.map((item) => {
              const active = effectivePath.startsWith(item.path || '_no_');
              return (
                <NavButton
                  key={item.key}
                  item={item}
                  active={!!active}
                  collapsed={collapsed}
                  onClick={() => handleNav(item.path)}
                />
              );
            })}
          </nav>
        </>
      )}

      <div className={cn('mt-auto pb-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
        {collapsed && <div className="mx-2 my-3 border-t border-border" />}
        {bottomMenu.map((item) => {
          const bottomActive = effectivePath.startsWith(item.path || '_no_');
          return (
            <NavButton
              key={item.key}
              item={item}
              active={!!bottomActive}
              collapsed={collapsed}
              onClick={() => handleNav(item.path)}
            />
          );
        })}
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  isSettingsActive,
  mobileOpen,
  onMobileClose,
  collapsed = false,
  onToggleCollapse,
}) => {
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 bg-background h-screen sticky top-0 transition-all duration-300 shadow-[8px_0_24px_-12px_rgba(0,0,0,0.12)] z-10',
          collapsed ? 'w-16' : 'w-48'
        )}
      >
        <Logo collapsed={collapsed} />
        <NavContent isSettingsActive={isSettingsActive} collapsed={collapsed} />

        {/* 折叠把手 */}
      <button
        onClick={onToggleCollapse}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 hidden md:flex items-center justify-center w-4 h-16 -mr-2 group/handle"
      >
        <div className="w-1 h-10 rounded-full bg-border group-hover/handle:bg-brand transition-colors" />
        <ChevronLeft
          className={cn(
            'absolute right-0 w-4 h-4 text-white opacity-0 group-hover/handle:opacity-100 transition-opacity', // 改成 text-white
            collapsed && 'rotate-180'
          )}
        />
      </button>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={onMobileClose}>
        <SheetContent side="left" className="w-64 p-0 bg-background border-r border-border">
          <Logo />
          <NavContent
            isSettingsActive={isSettingsActive}
            onItemClick={onMobileClose}
          />
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
};
