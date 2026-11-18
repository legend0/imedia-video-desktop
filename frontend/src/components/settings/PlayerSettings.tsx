import React, { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const PlayerSettings: React.FC = () => {
  const [autoplay, setAutoplay] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [boostEnabled, setBoostEnabled] = useState(true);
  const [speed, setSpeed] = useState('1.0');
  const [volume, setVolume] = useState(59);
  const [volumeStep, setVolumeStep] = useState(10);
  const [quality, setQuality] = useState('auto');
  const [skipStep, setSkipStep] = useState(10);
  const [autoFullscreen, setAutoFullscreen] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [controlsHideDelay, setControlsHideDelay] = useState(3000);
  const [skipIntroTime, setSkipIntroTime] = useState(0);
  const [skipOutroTime, setSkipOutroTime] = useState(0);
  const [enableShortcuts, setEnableShortcuts] = useState(true);
  const [hlsEnableWorker, setHlsEnableWorker] = useState(true);
  const [hlsEnableSoftwareAES, setHlsEnableSoftwareAES] = useState(true);
  const [hlsMaxBufferSize, setHlsMaxBufferSize] = useState(50);
  const [hlsMaxBufferLength, setHlsMaxBufferLength] = useState(30);

  useEffect(() => {
    if (!window.API?.settings?.getAll) return;
    window.API.settings.getAll().then((data: unknown) => {
      const settings = (data || {}) as Record<string, unknown>;
      const p = (settings.player as Record<string, unknown>) || {};
      if (p.autoplay !== undefined) setAutoplay(p.autoplay as boolean);
      if (p.autoNext !== undefined) setAutoNext(p.autoNext as boolean);
      if (p.boostEnabled !== undefined) setBoostEnabled(p.boostEnabled as boolean);
      if (p.speed !== undefined) setSpeed(String(Number(p.speed)));
      if (p.volume !== undefined) setVolume(p.volume as number);
      if (p.volumeStep) setVolumeStep(p.volumeStep as number);
      if (p.quality) setQuality(p.quality as string);
      if (p.skipStep) setSkipStep(p.skipStep as number);
      if (p.autoFullscreen !== undefined) setAutoFullscreen(p.autoFullscreen as boolean);
      if (p.showControls !== undefined) setShowControls(p.showControls as boolean);
      if (p.controlsHideDelay) setControlsHideDelay(p.controlsHideDelay as number);
      if (p.skipIntroTime !== undefined) setSkipIntroTime(p.skipIntroTime as number);
      if (p.skipOutroTime !== undefined) setSkipOutroTime(p.skipOutroTime as number);
      if (p.enableShortcuts !== undefined) setEnableShortcuts(p.enableShortcuts as boolean);
      if (p.hlsEnableWorker !== undefined) setHlsEnableWorker(p.hlsEnableWorker as boolean);
      if (p.hlsEnableSoftwareAES !== undefined) setHlsEnableSoftwareAES(p.hlsEnableSoftwareAES as boolean);
      if (p.hlsMaxBufferSize) setHlsMaxBufferSize(p.hlsMaxBufferSize as number);
      if (p.hlsMaxBufferLength) setHlsMaxBufferLength(p.hlsMaxBufferLength as number);
    });
  }, []);

  const updateSetting = (key: string, value: unknown) => {
    window.API?.settings?.set?.(`player.${key}`, value);
  };

  return (
    <div className="space-y-8">
      {/* 播放设置 */}
      <div id="player" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">播放设置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>自动播放</Label>
              <p className="text-xs text-muted-foreground">打开视频时自动开始播放</p>
            </div>
            <Switch
              checked={autoplay}
              onCheckedChange={(v) => {
                setAutoplay(v);
                updateSetting('autoplay', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>自动播放下一集</Label>
              <p className="text-xs text-muted-foreground">当前集播放结束后自动播放下一集</p>
            </div>
            <Switch
              checked={autoNext}
              onCheckedChange={(v) => {
                setAutoNext(v);
                updateSetting('autoNext', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>M3U8 加速代理</Label>
              <p className="text-xs text-muted-foreground">通过本地代理加速 m3u8 流播放，失败自动降级为直连</p>
            </div>
            <Switch
              checked={boostEnabled}
              onCheckedChange={(v) => {
                setBoostEnabled(v);
                updateSetting('boostEnabled', v);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>默认播放速度</Label>
            <Select
              value={speed}
              onValueChange={(v) => {
                setSpeed(v);
                updateSetting('speed', parseFloat(v));
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0.5x</SelectItem>
                <SelectItem value="0.75">0.75x</SelectItem>
                <SelectItem value="1">1.0x</SelectItem>
                <SelectItem value="1.25">1.25x</SelectItem>
                <SelectItem value="1.5">1.5x</SelectItem>
                <SelectItem value="2">2.0x</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>默认音量</Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  updateSetting('volume', v);
                }}
                className="flex-1 h-2 rounded-lg appearance-none bg-muted cursor-pointer accent-brand"
              />
              <span className="w-12 text-sm text-muted-foreground text-right">{volume}%</span>
            </div>
            <p className="text-xs text-muted-foreground">设置播放器打开时的默认音量</p>
          </div>

          <div className="space-y-2">
            <Label>默认画质</Label>
            <Select
              value={quality}
              onValueChange={(v) => {
                setQuality(v);
                updateSetting('quality', v);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="1080p">1080P</SelectItem>
                <SelectItem value="720p">720P</SelectItem>
                <SelectItem value="480p">480P</SelectItem>
                <SelectItem value="360p">360P</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">优先选择的视频清晰度（自动表示按源默认）</p>
          </div>

          <div className="space-y-2">
            <Label>音量调节步长</Label>
            <Select
              value={String(volumeStep)}
              onValueChange={(v) => {
                const num = Number(v);
                setVolumeStep(num);
                updateSetting('volumeStep', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="10">10%</SelectItem>
                <SelectItem value="15">15%</SelectItem>
                <SelectItem value="20">20%</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置音量调节的步长</p>
          </div>

          <div className="space-y-2">
            <Label>跳转步长</Label>
            <Select
              value={String(skipStep)}
              onValueChange={(v) => {
                const num = Number(v);
                setSkipStep(num);
                updateSetting('skipStep', num);
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
            <p className="text-xs text-muted-foreground">使用左右方向键快进/快退的步长</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>自动全屏</Label>
              <p className="text-xs text-muted-foreground">双击视频时自动进入全屏</p>
            </div>
            <Switch
              checked={autoFullscreen}
              onCheckedChange={(v) => {
                setAutoFullscreen(v);
                updateSetting('autoFullscreen', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>显示控制条</Label>
              <p className="text-xs text-muted-foreground">播放时显示底部控制条</p>
            </div>
            <Switch
              checked={showControls}
              onCheckedChange={(v) => {
                setShowControls(v);
                updateSetting('showControls', v);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>控制条隐藏延迟</Label>
            <Select
              value={String(controlsHideDelay)}
              onValueChange={(v) => {
                const num = Number(v);
                setControlsHideDelay(num);
                updateSetting('controlsHideDelay', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2000">2秒</SelectItem>
                <SelectItem value="3000">3秒</SelectItem>
                <SelectItem value="5000">5秒</SelectItem>
                <SelectItem value="8000">8秒</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">播放时控制条自动隐藏的延迟时间</p>
          </div>

          <div className="space-y-2">
            <Label>跳过片头秒数</Label>
            <input
              type="number"
              min={0}
              max={600}
              value={skipIntroTime}
              onChange={(e) => {
                const v = Math.max(0, Math.min(600, Number(e.target.value) || 0));
                setSkipIntroTime(v);
                updateSetting('skipIntroTime', v);
              }}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">视频开始时自动跳过的秒数（0表示不跳过）</p>
          </div>

          <div className="space-y-2">
            <Label>跳过片尾秒数</Label>
            <input
              type="number"
              min={0}
              max={600}
              value={skipOutroTime}
              onChange={(e) => {
                const v = Math.max(0, Math.min(600, Number(e.target.value) || 0));
                setSkipOutroTime(v);
                updateSetting('skipOutroTime', v);
              }}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">视频结束前自动跳过的秒数（0表示不跳过）</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>启用快捷键</Label>
              <p className="text-xs text-muted-foreground">播放时使用键盘快捷键控制（空格暂停、方向键快进等）</p>
            </div>
            <Switch
              checked={enableShortcuts}
              onCheckedChange={(v) => {
                setEnableShortcuts(v);
                updateSetting('enableShortcuts', v);
              }}
            />
          </div>
        </div>
      </div>

      {/* HLS 配置 */}
      <div id="hls" className="space-y-4 scroll-mt-4">
        <h3 className="text-base font-semibold text-foreground">HLS 配置</h3>
        <div className="rounded-xl bg-card shadow-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>启用 Worker</Label>
              <p className="text-xs text-muted-foreground">启用 HLS.js Worker 以提高性能</p>
            </div>
            <Switch
              checked={hlsEnableWorker}
              onCheckedChange={(v) => {
                setHlsEnableWorker(v);
                updateSetting('hlsEnableWorker', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>软件 AES 解密</Label>
              <p className="text-xs text-muted-foreground">使用软件进行 AES 解密</p>
            </div>
            <Switch
              checked={hlsEnableSoftwareAES}
              onCheckedChange={(v) => {
                setHlsEnableSoftwareAES(v);
                updateSetting('hlsEnableSoftwareAES', v);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>最大缓冲区大小</Label>
            <Select
              value={String(hlsMaxBufferSize)}
              onValueChange={(v) => {
                const num = Number(v);
                setHlsMaxBufferSize(num);
                updateSetting('hlsMaxBufferSize', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20MB</SelectItem>
                <SelectItem value="50">50MB</SelectItem>
                <SelectItem value="100">100MB</SelectItem>
                <SelectItem value="200">200MB</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置 HLS 最大缓冲区大小</p>
          </div>

          <div className="space-y-2">
            <Label>最大缓冲时长</Label>
            <Select
              value={String(hlsMaxBufferLength)}
              onValueChange={(v) => {
                const num = Number(v);
                setHlsMaxBufferLength(num);
                updateSetting('hlsMaxBufferLength', num);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10秒</SelectItem>
                <SelectItem value="30">30秒</SelectItem>
                <SelectItem value="60">60秒</SelectItem>
                <SelectItem value="120">120秒</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">设置 HLS 最大缓冲时长</p>
          </div>
        </div>
      </div>
    </div>
  );
};
