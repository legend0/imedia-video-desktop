import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export interface NotificationItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  time: Date;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationsContextType {
  notifications: NotificationItem[];
  addNotification: (item: Omit<NotificationItem, 'id' | 'time'>) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  unreadCount: number;
  unreadIds: Set<string>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const stored = window.localStorage.getItem('movie-island-notifications');
        if (stored) {
          const parsed = JSON.parse(stored);
          setNotifications(parsed.notifications || []);
          setUnreadIds(new Set(parsed.unreadIds || []));
        }
      } catch {
        // ignore
      }
    };

    loadFromStorage();
  }, []);

  // 持久化节流：500ms 合并多次状态变化，避免高频全量 stringify
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      // 仅持久化必要字段，丢弃函数类型的 action（不可序列化且体积大）
      const serializable = notifications.slice(0, 50).map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        time: n.time,
      }));
      try {
        window.localStorage.setItem('movie-island-notifications', JSON.stringify({
          notifications: serializable,
          unreadIds: Array.from(unreadIds),
        }));
      } catch {
        // 忽略配额异常
      }
    }, 500);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [notifications, unreadIds]);

  const addNotification = useCallback((item: Omit<NotificationItem, 'id' | 'time'>) => {
    const newNotification: NotificationItem = {
      ...item,
      id: `n-${crypto.randomUUID()}`,
      time: new Date(),
    };
    setNotifications((prev) => [newNotification, ...prev].slice(0, 50));
    setUnreadIds((prev) => new Set([...prev, newNotification.id]));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadIds(new Set());
  }, []);

  const markAsRead = useCallback((id: string) => {
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setUnreadIds(new Set());
  }, []);

  const value = React.useMemo<NotificationsContextType>(() => ({
    notifications,
    addNotification,
    removeNotification,
    clearAll,
    unreadCount: unreadIds.size,
    unreadIds,
    markAsRead,
    markAllAsRead,
  }), [notifications, addNotification, removeNotification, clearAll, unreadIds, markAsRead, markAllAsRead]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
};

export const useNotifications = (): NotificationsContextType => {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }
  return context;
};
