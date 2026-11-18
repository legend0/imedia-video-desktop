import React, { useState } from 'react';
import { Film, Power, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/** 重置确认需输入的文本，防止误操作 */
const RESET_CONFIRM_TEXT = '重置应用';

const info = [
  { label: '应用名称', value: '影视岛资源管理系统' },
  { label: '应用版本', value: 'v1.0.0' },
  { label: '开发者', value: '影视岛团队' },
];

export const AboutSettings: React.FC = () => {
  const [restartOpen, setRestartOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetInput, setResetInput] = useState('');

  /** 重启应用：需用户在对话框中二次确认 */
  const handleRestart = async () => {
    setRestartOpen(false);
    try {
      await window.API?.app?.restart?.();
      toast.info('应用正在重启...');
    } catch (err) {
      toast.error('重启失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  /** 重置应用：要求用户输入"重置应用"后方可执行 */
  const handleReset = async () => {
    if (resetInput !== RESET_CONFIRM_TEXT) {
      toast.warning(`请输入"${RESET_CONFIRM_TEXT}"以确认重置`);
      return;
    }
    setResetOpen(false);
    setResetInput('');
    try {
      await window.API?.settings?.reset?.();
      await window.API?.video?.clearCache?.();
      toast.success('应用已重置，正在重启...');
      // 重置后自动重启，确保所有状态生效
      setTimeout(() => {
        window.API?.app?.restart?.();
      }, 800);
    } catch (err) {
      toast.error('重置失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  return (
    <div className="flex flex-col items-center max-w-md mx-auto space-y-8 py-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-orange flex items-center justify-center shadow-card">
          <Film className="w-10 h-10 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-foreground">影视岛资源管理系统</h3>
          <p className="text-sm text-muted-foreground mt-1">专注于影视资源分享</p>
        </div>
      </div>

      <div className="w-full rounded-xl bg-card shadow-card p-4 space-y-3">
        {info.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{item.label}</span>
            <span className="text-sm text-foreground font-medium">{item.value}</span>
          </div>
        ))}
      </div>

      {/* 免责声明：在维护操作上方提示应用性质与数据来源 */}
      <div className="w-full rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-4 space-y-2">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <h3 className="text-sm font-semibold">免责声明</h3>
        </div>
        <p className="text-xs text-amber-700/90 dark:text-amber-400/90 leading-relaxed">
          本应用仅作为影视资源检索与播放工具，不涉及、不收集、不存储任何影视文件及音视频内容，所有数据均来自第三方公开接口。
          所有资源版权归原作者或发行方所有，应用不对任何第三方接口的可用性、合法性、内容质量作任何担保。用户应在遵守当地法律法规的前提下使用本应用，因使用本应用产生的任何法律责任由用户自行承担。
        </p>
      </div>

      <div className="w-full rounded-xl bg-card shadow-card p-4 space-y-3">
        <h3 className="text-base font-semibold text-foreground text-center">维护操作</h3>
        <div className="flex justify-center gap-3">
          {/* 重启应用：点击后弹出确认对话框 */}
          <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Power className="w-4 h-4" /> 重启应用
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认重启应用？</AlertDialogTitle>
                <AlertDialogDescription>
                  重启将中断当前操作，应用会自动重新启动。未保存的数据可能丢失。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestart}>确认重启</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* 重置应用：要求输入"重置应用"文本确认 */}
          <AlertDialog
            open={resetOpen}
            onOpenChange={(open) => {
              setResetOpen(open);
              if (!open) setResetInput('');
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <RotateCcw className="w-4 h-4" /> 重置应用
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认重置应用？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将清除所有设置和缓存数据，且不可恢复。请输入"{RESET_CONFIRM_TEXT}"以确认。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                placeholder={`请输入"${RESET_CONFIRM_TEXT}"`}
                className="mt-2"
                autoFocus
              />
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  disabled={resetInput !== RESET_CONFIRM_TEXT}
                >
                  确认重置
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
};
