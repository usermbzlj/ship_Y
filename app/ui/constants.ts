/**
 * 共享 UI 常量
 * 从 mission-control.tsx 提取的跨组件常量数据
 */

import { AIR_HANDLER_IDS } from "@/lib/sim/compartments";
import { COOLANT_PUMP_IDS } from "@/lib/sim/cooling";
import {
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_LOAD_IDS,
  FUSION_REACTOR_IDS,
} from "@/lib/sim/electrical";
import { THRUSTER_IDS } from "@/lib/sim/navigation";
import { ROTATION_RING_IDS } from "@/lib/sim/rotation";
import { WATER_PROCESSOR_IDS } from "@/lib/sim/water";
import { MAINTENANCE_ASSET_IDS } from "@/lib/sim/maintenance";
import type { ViewId, ForceField, SystemCard } from "./types";

// ─── 星图数据 ─────────────────────────────────────────────────

export const STAR_SYSTEMS = [
  {
    id: "sol",
    name: "太阳系",
    port: "拉格朗日港",
    x: 14,
    y: 68,
    distanceFromSolLy: 0,
  },
  {
    id: "barnard",
    name: "巴纳德星",
    port: "赫尔墨斯中继站",
    x: 29,
    y: 45,
    distanceFromSolLy: 5.96,
  },
  {
    id: "wolf359",
    name: "沃尔夫 359",
    port: "远望补给环",
    x: 43,
    y: 72,
    distanceFromSolLy: 7.86,
  },
  {
    id: "sirius",
    name: "天狼星",
    port: "晨星自治领",
    x: 55,
    y: 34,
    distanceFromSolLy: 8.6,
  },
  {
    id: "epsilon",
    name: "波江座 ε",
    port: "阿斯特拉殖民地",
    x: 72,
    y: 57,
    distanceFromSolLy: 10.47,
  },
  {
    id: "tau-ceti",
    name: "鲸鱼座 τ",
    port: "新海岸",
    x: 86,
    y: 29,
    distanceFromSolLy: 11.9,
  },
] as const;

// ─── 导航 ─────────────────────────────────────────────────────

export const NAV_ITEMS: Array<{ id: ViewId; label: string; mark: string }> = [
  { id: "voyage", label: "航程", mark: "01" },
  { id: "ship", label: "舰体", mark: "02" },
  { id: "people", label: "乘员", mark: "03" },
  { id: "ai", label: "AI 观察", mark: "04" },
  { id: "god", label: "人工干预", mark: "05" },
];

// ─── 设备 ID 集合 ─────────────────────────────────────────────

export const THRUSTER_ID_SET = new Set<string>(THRUSTER_IDS);
export const FUSION_REACTOR_ID_SET = new Set<string>(FUSION_REACTOR_IDS);
export const COOLANT_PUMP_ID_SET = new Set<string>(COOLANT_PUMP_IDS);
export const ELECTRICAL_LOAD_ID_SET = new Set<string>(ELECTRICAL_LOAD_IDS);
export const ELECTRICAL_BREAKER_ID_SET = new Set<string>(ELECTRICAL_BREAKER_IDS);
export const ELECTRICAL_BATTERY_ID_SET = new Set<string>(ELECTRICAL_BATTERY_IDS);
export const ROTATION_RING_ID_SET = new Set<string>(ROTATION_RING_IDS);
export const AIR_HANDLER_ID_SET = new Set<string>(AIR_HANDLER_IDS);
export const WATER_PROCESSOR_ID_SET = new Set<string>(WATER_PROCESSOR_IDS);
export const MAINTENANCE_ASSET_ID_SET = new Set<string>(MAINTENANCE_ASSET_IDS);

export const RING_CONTROL_MODES = ["speed-hold", "coast", "brake"] as const;
export const RING_CONTROL_MODE_SET = new Set<string>(RING_CONTROL_MODES);
export const BATTERY_CONTROL_MODES = [
  "automatic",
  "charge-only",
  "discharge-only",
  "standby",
] as const;
export const BATTERY_CONTROL_MODE_SET = new Set<string>(BATTERY_CONTROL_MODES);
export const REACTOR_MODES = ["online", "hot-standby", "offline"] as const;
export const REACTOR_MODE_SET = new Set<string>(REACTOR_MODES);

// ─── 时间线 ───────────────────────────────────────────────────

export const MAX_TIMELINE_EVENTS = 500;

export const INITIAL_SYSTEMS: SystemCard[] = [
  {
    name: "聚变电网",
    value: "842 MW",
    detail: "4 在线 / 2 热备",
    load: 62,
    tone: "nominal",
  },
  {
    name: "热管理",
    value: "311 K",
    detail: "散热余量 38%",
    load: 58,
    tone: "nominal",
  },
  {
    name: "生命保障",
    value: "98.1%",
    detail: "四机组交叉供给",
    load: 74,
    tone: "nominal",
  },
  {
    name: "火炬推进",
    value: "24.00 t",
    detail: "推进剂 36.00 kt",
    load: 100,
    tone: "nominal",
  },
  {
    name: "旋转居住环",
    value: "1.002 g",
    detail: "A +2.000 · B −2.000 rpm",
    load: 100,
    tone: "nominal",
  },
  {
    name: "跃迁储能",
    value: "33.3%",
    detail: "充能中 · 联锁保持",
    load: 33,
    tone: "watch",
  },
];

// ─── 上帝模式力场 ─────────────────────────────────────────────

export const FORCE_FIELDS: ForceField[] = [
  {
    id: "coolant-temperature",
    label: "冷却母线温度",
    path: "thermal.coolantTemperatureK",
    unit: "K",
    defaultValue: "342.0",
  },
  {
    id: "generation",
    label: "聚变电网总发电",
    path: "power.generationKw",
    unit: "kW",
    defaultValue: "650000",
  },
  {
    id: "oxygen-mass",
    label: "居住区氧气总质量",
    path: "atmosphere.gasesKg.oxygen",
    unit: "kg",
    defaultValue: "118000",
  },
  {
    id: "leak-area",
    label: "等效舰体破口面积",
    path: "atmosphere.leakAreaSquareMeters",
    unit: "m²",
    defaultValue: "0.00008",
  },
  {
    id: "radiation-rate",
    label: "外部辐射剂量率",
    path: "environment.radiationDoseRateMilliSievertsPerHour",
    unit: "mSv/h",
    defaultValue: "2.5",
  },
  {
    id: "potable-water",
    label: "可饮用水库存",
    path: "water.potableKg",
    unit: "kg",
    defaultValue: "3200000",
  },
];

// ─── AI 花名册（静态展示用） ──────────────────────────────────

export const AI_ROSTER = [
  {
    id: "captain",
    role: "舰长",
    name: "乾枢",
    model: "主推理模型",
    state: "等待最高指令",
    cadence: "自主",
  },
  {
    id: "navigation",
    role: "导航与跃迁",
    name: "北辰",
    model: "推理模型",
    state: "航路预计算",
    cadence: "28 分钟",
  },
  {
    id: "engineering",
    role: "工程与能源",
    name: "炉心",
    model: "推理模型",
    state: "全系统监测",
    cadence: "11 分钟",
  },
  {
    id: "life-support",
    role: "生命保障",
    name: "青穹",
    model: "推理模型",
    state: "大气与水循环监测",
    cadence: "1 小时",
  },
  {
    id: "medical",
    role: "医疗与休眠",
    name: "白塔",
    model: "医疗模型",
    state: "待命",
    cadence: "47 分钟",
  },
  {
    id: "passenger-affairs",
    role: "乘客事务",
    name: "栖居",
    model: "轻量模型",
    state: "处理 14 项请求",
    cadence: "19 分钟",
  },
  {
    id: "security",
    role: "安保与应急",
    name: "界碑",
    model: "推理模型",
    state: "全舰通行态势监测",
    cadence: "2 小时",
  },
  {
    id: "passenger-service",
    role: "乘客服务",
    name: "归栖",
    model: "轻量模型",
    state: "处理生活服务队列",
    cadence: "12 小时",
  },
];

// ─── 其他常量 ─────────────────────────────────────────────────

export const MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE = 8;
export const AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS = 60;
export const AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS = 300;
export const AUTHORIZED_RECORD_HISTORY_LIMIT = 1_024;

// ─── Re-export device IDs for tool definitions ────────────────

export {
  AIR_HANDLER_IDS,
  COOLANT_PUMP_IDS,
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_LOAD_IDS,
  FUSION_REACTOR_IDS,
  THRUSTER_IDS,
  ROTATION_RING_IDS,
  WATER_PROCESSOR_IDS,
  MAINTENANCE_ASSET_IDS,
};
