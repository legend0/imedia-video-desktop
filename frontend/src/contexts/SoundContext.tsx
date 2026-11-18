import React, { createContext, useContext, useRef, useMemo, useEffect } from 'react';
import { SoundPool } from '@/plugins/sound';
import { DEFAULT_SOUNDS } from '@/plugins/sound';

interface SoundContextType {
  /** 播放指定音效 */
  play: (key: string) => boolean;
  /** 停止当前播放 */
  stop: () => void;
  /** 设置全局音量（0-1） */
  setVolume: (vol: number) => void;
  /** 启用/禁用音效 */
  setEnabled: (enabled: boolean) => void;
  /** 检查音效是否在冷却中 */
  isCoolingDown: (key: string) => boolean;
  /** 检查音效是否已注册 */
  has: (key: string) => boolean;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

/**
 * 音效系统 Provider
 * 创建 SoundPool 实例并预注册 5 个音效，通过 Context 向下暴露 play 等方法
 */
export const SoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const poolRef = useRef<SoundPool | null>(null);

  if (!poolRef.current) {
    poolRef.current = new SoundPool({ cooldown: 1000, volume: 0.5 });
    poolRef.current.registerAll(DEFAULT_SOUNDS);
  }

  useEffect(() => {
    return () => {
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  const value = useMemo<SoundContextType>(() => {
    const pool = poolRef.current!;
    return {
      play: (key: string) => pool.play(key),
      stop: () => pool.stop(),
      setVolume: (vol: number) => pool.setVolume(vol),
      setEnabled: (enabled: boolean) => pool.setEnabled(enabled),
      isCoolingDown: (key: string) => pool.isCoolingDown(key),
      has: (key: string) => pool.has(key),
    };
  }, []);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
};

/**
 * 获取音效系统接口
 * @returns 音效操作方法集合
 * @throws 当未处于 SoundProvider 内时抛出错误
 */
export const useSound = (): SoundContextType => {
  const context = useContext(SoundContext);
  if (!context) {
    throw new Error('useSound must be used within SoundProvider');
  }
  return context;
};
