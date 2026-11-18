import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Minimize2, Power } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CloseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 关闭操作类型：tray=最小化到托盘，exit=直接退出 */
type CloseAction = 'tray' | 'exit';

/**
 * 关闭窗口确认对话框
 * 参考旧 demo 项目的 showCloseConfirm 逻辑：
 * - 提供两个选项：最小化到托盘 / 直接退出
 * - 可选"记住我的选择"，勾选后保存到 app.closeBehavior 设置项
 */
export const CloseConfirmDialog: React.FC<CloseConfirmDialogProps> = ({ open, onOpenChange }) => {
  const [action, setAction] = useState<CloseAction>('exit');
  const [remember, setRemember] = useState(false);

  /** 每次打开时重置为默认值 */
  useEffect(() => {
    if (open) {
      setAction('exit');
      setRemember(false);
    }
  }, [open]);

  /** 执行关闭操作：先关闭对话框再执行窗口操作，避免窗口再次显示时对话框闪烁 */
  const executeAction = (selected: CloseAction) => {
    if (remember) {
      window.API?.settings?.set?.('app.closeBehavior', selected);
    }
    onOpenChange(false);
    if (selected === 'tray') {
      window.API?.window?.hide();
    } else {
      window.API?.window?.close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>关闭确认</DialogTitle>
          <DialogDescription>您想如何处理应用程序？</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <button
            onClick={() => setAction('tray')}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all',
              action === 'tray'
                ? 'border-brand bg-brand/5'
                : 'border-border hover:border-muted-foreground/40'
            )}
          >
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                action === 'tray' ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'
              )}
            >
              <Minimize2 className="w-5 h-5" />
            </div>
            <span
              className={cn(
                'text-sm font-medium',
                action === 'tray' ? 'text-brand' : 'text-foreground'
              )}
            >
              最小化到托盘
            </span>
          </button>

          <button
            onClick={() => setAction('exit')}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all',
              action === 'exit'
                ? 'border-brand bg-brand/5'
                : 'border-border hover:border-muted-foreground/40'
            )}
          >
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                action === 'exit' ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'
              )}
            >
              <Power className="w-5 h-5" />
            </div>
            <span
              className={cn(
                'text-sm font-medium',
                action === 'exit' ? 'text-brand' : 'text-foreground'
              )}
            >
              直接退出
            </span>
          </button>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none py-1">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          <span className="text-sm text-muted-foreground">记住我的选择</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => executeAction(action)}>确认</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
