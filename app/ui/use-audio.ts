"use client";

import { useCallback, useRef } from "react";

/**
 * 合成音效引擎 — 使用 Web Audio API，不引入外部音频文件。
 * 提供按钮反馈、分级警报、跃迁充能/释放、设备启停和低频环境底噪。
 */

type AudioCategory = "master" | "alert" | "ui" | "ambient";

interface AudioVolumes {
  master: number;
  alert: number;
  ui: number;
  ambient: number;
}

const DEFAULT_VOLUMES: AudioVolumes = {
  master: 0.7,
  alert: 0.8,
  ui: 0.5,
  ambient: 0.3,
};

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  if (sharedContext.state === "suspended") {
    void sharedContext.resume();
  }
  return sharedContext;
}

export function useAudio() {
  const volumesRef = useRef<AudioVolumes>({ ...DEFAULT_VOLUMES });
  const ambientNodeRef = useRef<{
    oscillator: OscillatorNode;
    gain: GainNode;
  } | null>(null);
  const enabledRef = useRef(true);

  const getVolume = useCallback((category: AudioCategory): number => {
    if (!enabledRef.current) return 0;
    const v = volumesRef.current;
    return v.master * v[category];
  }, []);

  const setVolume = useCallback(
    (category: AudioCategory, value: number) => {
      volumesRef.current[category] = Math.max(0, Math.min(1, value));
      if (category === "ambient" || category === "master") {
        const node = ambientNodeRef.current;
        if (node) {
          node.gain.gain.setTargetAtTime(
            getVolume("ambient") * 0.04,
            getContext().currentTime,
            0.1,
          );
        }
      }
    },
    [getVolume],
  );

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    if (!enabled && ambientNodeRef.current) {
      ambientNodeRef.current.gain.gain.setTargetAtTime(
        0,
        getContext().currentTime,
        0.05,
      );
    }
  }, []);

  /** 短促按钮点击 */
  const playClick = useCallback(() => {
    const vol = getVolume("ui");
    if (vol <= 0) return;
    const ctx = getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(vol * 0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.07);
  }, [getVolume]);

  /** 确认/成功音 */
  const playConfirm = useCallback(() => {
    const vol = getVolume("ui");
    if (vol <= 0) return;
    const ctx = getContext();
    const t = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + i * 0.08);
      gain.gain.linearRampToValueAtTime(vol * 0.12, t + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.16);
    });
  }, [getVolume]);

  /** 注意级警报 — 单蜂鸣 */
  const playAlertWatch = useCallback(() => {
    const vol = getVolume("alert");
    if (vol <= 0) return;
    const ctx = getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(vol * 0.08, ctx.currentTime);
    gain.gain.setValueAtTime(vol * 0.08, ctx.currentTime + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.22);
  }, [getVolume]);

  /** 警告级警报 — 双音 */
  const playAlertWarning = useCallback(() => {
    const vol = getVolume("alert");
    if (vol <= 0) return;
    const ctx = getContext();
    const t = ctx.currentTime;
    [0, 0.18].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = offset === 0 ? 780 : 620;
      gain.gain.setValueAtTime(vol * 0.1, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.15);
    });
  }, [getVolume]);

  /** 紧急级警报 — 连续脉冲 */
  const playAlertCritical = useCallback(() => {
    const vol = getVolume("alert");
    if (vol <= 0) return;
    const ctx = getContext();
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 880;
      const start = t + i * 0.12;
      gain.gain.setValueAtTime(vol * 0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.09);
    }
  }, [getVolume]);

  /** 跃迁充能 — 上升扫频 */
  const playJumpCharge = useCallback(() => {
    const vol = getVolume("ui");
    if (vol <= 0) return;
    const ctx = getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 1.8);
    gain.gain.setValueAtTime(vol * 0.06, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol * 0.12, ctx.currentTime + 1.5);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 2.1);
  }, [getVolume]);

  /** 跃迁释放 — 瞬态冲击 + 衰减 */
  const playJumpRelease = useCallback(() => {
    const vol = getVolume("ui");
    if (vol <= 0) return;
    const ctx = getContext();
    const t = ctx.currentTime;
    // 噪声冲击
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.2, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(t);
    // 低频冲击
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    oscGain.gain.setValueAtTime(vol * 0.25, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  }, [getVolume]);

  /** 设备启停 — 机械咔嗒 */
  const playDeviceToggle = useCallback(() => {
    const vol = getVolume("ui");
    if (vol <= 0) return;
    const ctx = getContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.05);
    gain.gain.setValueAtTime(vol * 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }, [getVolume]);

  /** 启动低频环境底噪 */
  const startAmbient = useCallback(() => {
    if (ambientNodeRef.current) return;
    const ctx = getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 42;
    gain.gain.value = getVolume("ambient") * 0.04;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    ambientNodeRef.current = { oscillator: osc, gain };
  }, [getVolume]);

  /** 停止环境底噪 */
  const stopAmbient = useCallback(() => {
    const node = ambientNodeRef.current;
    if (node) {
      node.oscillator.stop();
      ambientNodeRef.current = null;
    }
  }, []);

  return {
    playClick,
    playConfirm,
    playAlertWatch,
    playAlertWarning,
    playAlertCritical,
    playJumpCharge,
    playJumpRelease,
    playDeviceToggle,
    startAmbient,
    stopAmbient,
    setVolume,
    setEnabled,
    volumes: volumesRef.current,
  };
}
