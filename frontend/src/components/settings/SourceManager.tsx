import React, { useMemo, useState, useEffect } from 'react';
import {
  Plus,
  AlertTriangle,
  Rss,
  Search,
  TestTube,
  Pencil,
  EyeOff,
  Eye,
  Trash2,
  ChevronDown,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SourceItemData } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

/** 尝试 base64 解码，失败则返回原文 */
function tryDecodeBase64(str: string): string {
  if (!str) return '';
  try {
    const decoded = atob(str.trim());
    if (decoded && /[\u4e00-\u9fff\w\s.,;:!?()【】\-]/.test(decoded)) {
      return decoded;
    }
    return str;
  } catch {
    return str;
  }
}

/** 后端源对象（{enable, name, url, path, type, isAdult, isActive, search, test, description}）转前端 SourceItemData */
function convertSource(key: string, source: Record<string, unknown>): SourceItemData {
  const test = (source.test as Record<string, unknown>) || {};
  const rawDesc = (source.description as string) || '';
  return {
    id: key,
    name: (source.name as string) || '',
    url: (source.url as string) || '',
    enabled: source.enable !== false,
    adult: (source.isAdult as boolean) || false,
    format: (source.type as string) || 'json',
    searchable: source.search === undefined ? null : (source.search as boolean),
    responseTime: test.responseTime as number | undefined,
    failed: test.success === false,
    description: rawDesc ? tryDecodeBase64(rawDesc) : '',
    isActive: (source.isActive as boolean) || false,
    isDefault: key === 'default',
  };
}

/** 前端 SourceItemData 转后端源对象（path 使用默认值） */
function convertToBackendSource(item: SourceItemData): Record<string, unknown> {
  return {
    name: item.name,
    url: item.url,
    path: '/api.php/provide/vod/',
    type: item.format || 'json',
    isAdult: item.adult,
    enable: item.enabled,
    isActive: false,
    search: item.searchable ?? true,
    description: item.description || '',
    test: {
      success: !item.failed,
      responseTime: item.responseTime || 0,
      status: 0,
      timestamp: Date.now(),
    },
  };
}

const StatusTag: React.FC<{ children: React.ReactNode; color?: 'green' | 'blue' | 'purple' | 'red' | 'orange' }> = ({
  children,
  color = 'green',
}) => {
  const colorMap = {
    green: 'bg-green/10 text-green',
    blue: 'bg-blue/10 text-blue',
    purple: 'bg-purple/10 text-purple',
    red: 'bg-destructive/10 text-destructive',
    orange: 'bg-orange/10 text-orange',
  };

  return (
    <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', colorMap[color])}>
      {children}
    </span>
  );
};

/** 根据源状态返回左侧色条的颜色类：禁用=灰、测试失败=红、正常=绿 */
function getSourceStripeColor(item: SourceItemData): string {
  if (!item.enabled) return 'bg-muted-foreground';
  if (item.failed) return 'bg-destructive';
  return 'bg-green';
}

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已禁用' },
];

const contentOptions = [
  { value: 'all', label: '全部内容' },
  { value: 'adult', label: '成人内容' },
  { value: 'general', label: '普通内容' },
];

const emptySource: SourceItemData = {
  id: '',
  name: '',
  url: '',
  enabled: true,
  adult: false,
  format: 'json',
  searchable: true,
};

export const SourceManager: React.FC = () => {
  const [sources, setSources] = useState<SourceItemData[]>([]);
  const [editing, setEditing] = useState<SourceItemData | null>(null);
  const [deleting, setDeleting] = useState<SourceItemData | null>(null);
  const [testing, setTesting] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeUrl, setSubscribeUrl] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [contentFilter, setContentFilter] = useState('all');
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeResult, setSubscribeResult] = useState<{ added: number; skipped: number; failed: number } | null>(null);
  const [singleTestingId, setSingleTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (!window.API?.source?.getSourceList) return;
    window.API.source.getSourceList().then((data: unknown) => {
      const raw = (data || {}) as Record<string, unknown>;
      const list = Object.entries(raw).map(([key, source]) =>
        convertSource(key, source as Record<string, unknown>)
      );
      if (list.length > 0) setSources(list);
    });
  }, []);

  const openAdd = () => setEditing({ ...emptySource, id: `new-${Date.now()}` });

  const filteredSources = useMemo(() => {
    return sources.filter((item) => {
      const matchSearch =
        !searchText.trim() ||
        item.name.toLowerCase().includes(searchText.toLowerCase()) ||
        item.url.toLowerCase().includes(searchText.toLowerCase());
      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'enabled'
            ? item.enabled
            : !item.enabled;
      const matchContent =
        contentFilter === 'all'
          ? true
          : contentFilter === 'adult'
            ? item.adult
            : !item.adult;
      return matchSearch && matchStatus && matchContent;
    });
  }, [sources, searchText, statusFilter, contentFilter]);

  const handleSave = async () => {
    if (!editing || !editing.name.trim() || !editing.url.trim()) {
      toast.error('请填写源名称和地址');
      return;
    }
    const isNew = editing.id.startsWith('new-');
    try {
      if (window.API?.source) {
        const backendSource = convertToBackendSource(editing);
        if (isNew) {
          const newId = 'source_' + Date.now().toString(36);
          await window.API.source.addSource(newId, backendSource);
          setSources((prev) => [{ ...editing, id: newId }, ...prev]);
          toast.success('源已添加');
        } else {
          await window.API.source.updateSource(editing.id, backendSource);
          setSources((prev) => prev.map((s) => (s.id === editing.id ? editing : s)));
          toast.success('源信息已更新');
        }
      } else {
        if (isNew) {
          const newItem = { ...editing, id: editing.id.replace('new-', 's') };
          setSources((prev) => [newItem, ...prev]);
          toast.success('源已添加');
        } else {
          setSources((prev) => prev.map((s) => (s.id === editing.id ? editing : s)));
          toast.success('源信息已更新');
        }
      }
    } catch (err) {
      toast.error('保存失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
    setEditing(null);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      if (window.API?.source) {
        await window.API.source.removeSource(deleting.id);
      }
      setSources((prev) => prev.filter((s) => s.id !== deleting.id));
      toast.success('源已删除');
    } catch (err) {
      toast.error('删除失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
    setDeleting(null);
  };

  const testAll = async () => {
    if (!window.API?.source?.testSource) {
      toast.info('API 不可用，跳过测试');
      return;
    }
    setTesting(true);
    toast.info('开始测试全部资源源...');
    let successCount = 0;
    let failCount = 0;
    for (const item of sources) {
      try {
        const result = await window.API.source.testSource(item.id);
        const testResult = (result || {}) as Record<string, unknown>;
        const responseTime = testResult.responseTime as number | undefined;
        const search = testResult.search as boolean | undefined;
        const failed = testResult.success === false;
        setSources((prev) =>
          prev.map((s) =>
            s.id === item.id
              ? { ...s, responseTime, failed, searchable: search ?? s.searchable }
              : s
          )
        );
        if (!failed) successCount++;
        else failCount++;
      } catch {
        setSources((prev) =>
          prev.map((s) => (s.id === item.id ? { ...s, failed: true } : s))
        );
        failCount++;
      }
    }
    setTesting(false);
    toast.success(`测试完成，成功: ${successCount}，失败: ${failCount}`);
    window.dispatchEvent(new CustomEvent('source:changed'));
  };

  /** 切换单个源的启用/禁用状态 */
  const toggleSource = async (item: SourceItemData) => {
    const updated = { ...item, enabled: !item.enabled };
    try {
      if (window.API?.source) {
        await window.API.source.updateSource(item.id, convertToBackendSource(updated));
      }
      setSources((prev) => prev.map((s) => (s.id === item.id ? updated : s)));
      toast.success(`源已${updated.enabled ? '启用' : '禁用'}`);
    } catch (err) {
      toast.error('切换失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  /** 切换当前激活源 */
  const handleSwitchSource = async (item: SourceItemData) => {
    if (item.isActive) return;
    try {
      if (window.API?.source?.setCurrentSource) {
        await window.API.source.setCurrentSource(item.id);
      }
      setSources((prev) => prev.map((s) => ({ ...s, isActive: s.id === item.id })));
      toast.success(`已切换到源「${item.name}」`);
      window.dispatchEvent(new CustomEvent('source:changed'));
    } catch (err) {
      toast.error('切换源失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  /** 测试单个源 */
  const testSingle = async (item: SourceItemData) => {
    if (!window.API?.source?.testSource) {
      toast.info('API 不可用，跳过测试');
      return;
    }
    setSingleTestingId(item.id);
    try {
      const result = await window.API.source.testSource(item.id);
      const testResult = (result || {}) as Record<string, unknown>;
      const responseTime = testResult.responseTime as number | undefined;
      const search = testResult.search as boolean | undefined;
      const failed = testResult.success === false;
      setSources((prev) =>
        prev.map((s) =>
          s.id === item.id
            ? { ...s, responseTime, failed, searchable: search ?? s.searchable }
            : s
        )
      );
      if (failed) {
        toast.warning(`源 ${item.name} 测试失败`);
      } else {
        toast.success(`源 ${item.name} 测试成功`);
      }
    } catch (err) {
      setSources((prev) => prev.map((s) => (s.id === item.id ? { ...s, failed: true } : s)));
      toast.error(`测试失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
    setSingleTestingId(null);
  };

  const DEFAULT_SUBSCRIPTION_URL = '';

  const openSubscribe = () => {
    setSubscribeResult(null);
    setSubscribing(true);
    if (window.API?.settings?.get) {
      window.API.settings.get('ui.subscriptionUrl').then((value: unknown) => {
        setSubscribeUrl(typeof value === 'string' && value ? value : DEFAULT_SUBSCRIPTION_URL);
      });
    } else {
      setSubscribeUrl(DEFAULT_SUBSCRIPTION_URL);
    }
  };

  /** 订阅：调用后端 API 解析并添加源。保存订阅地址供下次使用 */
  const handleSubscribe = async () => {
    const url = subscribeUrl.trim();
    if (!url) {
      toast.error('请输入订阅地址');
      return;
    }
    setSubscribeLoading(true);
    setSubscribeResult(null);
    // 先保存订阅地址，确保即使订阅失败也能供自动订阅使用
    window.API?.settings?.set?.('ui.subscriptionUrl', url);
    try {
      if (!window.API?.source?.subscribe) {
        throw new Error('订阅 API 不可用');
      }
      const result = await window.API.source.subscribe(url);
      if (result.success && result.data) {
        setSubscribeResult(result.data);
        toast.success(`订阅完成：新增 ${result.data.added}，跳过 ${result.data.skipped}，失败 ${result.data.failed}`);
        window.API.source.getSourceList().then((data: unknown) => {
          const raw = (data || {}) as Record<string, unknown>;
          const list = Object.entries(raw).map(([key, source]) =>
            convertSource(key, source as Record<string, unknown>)
          );
          if (list.length > 0) setSources(list);
        });
      } else {
        throw new Error(result.error || '订阅失败');
      }
    } catch (err) {
      toast.error('订阅失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
    setSubscribeLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={openAdd} className="gap-1.5 bg-brand hover:bg-brand/90 text-white rounded-xl">
            <Plus className="w-4 h-4" /> 添加源
          </Button>
          <Button
            variant="outline"
            onClick={testAll}
            disabled={testing}
            className="gap-1.5 border-orange/30 text-orange hover:bg-orange/10 rounded-xl"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            测试源
          </Button>
          <Button
            variant="outline"
            onClick={openSubscribe}
            className="gap-1.5 border-green/30 text-green hover:bg-green/10 rounded-xl"
          >
            <Rss className="w-4 h-4" /> 订阅源
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索源..."
              className="h-9 pl-8 pr-3 rounded-xl border border-input bg-card text-sm outline-none focus:ring-2 focus:ring-ring/30 w-48"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 rounded-xl border-input w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={contentFilter} onValueChange={setContentFilter}>
            <SelectTrigger className="h-9 rounded-xl border-input w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contentOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {filteredSources.map((item) => (
          <div
            key={item.id}
            className={cn(
              'relative flex items-center justify-between rounded-xl bg-card p-4 shadow-card hover:shadow-hover transition-all',
              item.isActive && 'ring-2 ring-brand shadow-hover'
            )}
          >
            <div className={cn('absolute left-0 top-3 bottom-3 w-1 rounded-r-full', getSourceStripeColor(item))} />
            <div className="flex-1 min-w-0 pl-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-foreground">{item.name}</span>
                {item.isActive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-brand/15 text-brand">
                    <CheckCircle className="w-3 h-3" /> 当前源
                  </span>
                )}
                {item.isDefault && <StatusTag color="orange">默认</StatusTag>}
                {item.enabled && <StatusTag color="green">已启用</StatusTag>}
                {item.adult && <StatusTag color="blue">成人内容</StatusTag>}
                <StatusTag color="blue">{item.format}</StatusTag>
                {item.searchable === true && <StatusTag color="purple">支持搜索</StatusTag>}
                {item.searchable === false && <StatusTag color="red">不支持搜索</StatusTag>}
                {item.failed && <StatusTag color="red">测试失败</StatusTag>}
                {typeof item.responseTime === 'number' && !item.failed && (
                  <StatusTag color="orange">{item.responseTime.toFixed(2)}ms</StatusTag>
                )}
                <span className="ml-auto text-xs text-muted-foreground truncate max-w-xs" title={item.url}>
                  {item.url}
                </span>
              </div>
              {item.description && (
                <p className="text-sm text-muted-foreground truncate">{item.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 ml-4 shrink-0">
              {!item.isActive && item.enabled && (
                <button
                  onClick={() => handleSwitchSource(item)}
                  title="设为当前源"
                  className="h-8 px-2 flex items-center gap-1 rounded-lg hover:bg-brand/10 text-brand text-xs font-medium transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> 设为当前
                </button>
              )}
              <button
                onClick={() => testSingle(item)}
                disabled={singleTestingId === item.id}
                title="测试"
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
              >
                {singleTestingId === item.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TestTube className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => setEditing(item)}
                title="编辑"
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => toggleSource(item)}
                disabled={item.isActive}
                title={item.isActive ? '当前源不可禁用' : item.enabled ? '禁用' : '启用'}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {item.enabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              {!item.isDefault && (
                <button
                  onClick={() => setDeleting(item)}
                  disabled={item.isActive}
                  title={item.isActive ? '当前源不可删除' : '删除'}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id?.startsWith('new-') ? '添加源' : '编辑源'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>源名称</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：155资源"
                />
              </div>
              <div className="space-y-2">
                <Label>源地址</Label>
                <Input
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  placeholder="https://example.com/api.php/provide/vod/"
                />
              </div>
              <div className="space-y-2">
                <Label>数据格式</Label>
                <Select
                  value={editing.format || 'json'}
                  onValueChange={(v) => setEditing({ ...editing, format: v })}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="xml">XML</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>成人内容</Label>
                <Switch
                  checked={editing.adult}
                  onCheckedChange={(v) => setEditing({ ...editing, adult: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>支持搜索</Label>
                <Switch
                  checked={editing.searchable ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, searchable: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={handleSave} className="bg-brand hover:bg-brand/90 text-white">
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除源「{deleting?.name}」吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleting(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={subscribing} onOpenChange={(open) => !open && setSubscribing(false)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle>订阅源</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>订阅地址</Label>
              <Input
                value={subscribeUrl}
                onChange={(e) => setSubscribeUrl(e.target.value)}
                placeholder="https://gitee.com/xxx/resources.json"
                disabled={subscribeLoading}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              订阅地址将自动保存，下次打开时自动填入。解析订阅源中的 description 字段（base64 编码）并显示为源描述。
            </p>

            {subscribeLoading && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
                <Loader2 className="w-4 h-4 animate-spin text-brand" />
                <span className="text-sm text-muted-foreground">正在解析订阅并添加源...</span>
              </div>
            )}

            {subscribeResult && !subscribeLoading && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">订阅更新完成</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-green">新增：{subscribeResult.added}</span>
                  <span className="text-orange">跳过：{subscribeResult.skipped}</span>
                  <span className="text-destructive">失败：{subscribeResult.failed}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubscribing(false)} disabled={subscribeLoading}>
              关闭
            </Button>
            <Button
              onClick={handleSubscribe}
              disabled={subscribeLoading}
              className="bg-green hover:bg-green/90 text-white gap-1.5"
            >
              {subscribeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rss className="w-4 h-4" />}
              更新订阅
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
