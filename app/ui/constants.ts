/**
 * 共享 UI 常量
 * 从 mission-control.tsx 提取的跨组件常量数据
 */

import { STAR_SYSTEMS as CATALOG_STAR_SYSTEMS } from "@/lib/astro/star-catalog";
import { AIR_HANDLER_IDS } from "@/lib/sim/compartments";
import { COOLANT_PUMP_IDS, HABITAT_THERMAL_DELIVERY_SPUR_IDS } from "@/lib/sim/cooling";
import {
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_LOAD_IDS,
  FUSION_REACTOR_IDS,
} from "@/lib/sim/electrical";
import { THRUSTER_IDS } from "@/lib/sim/navigation";
import { ROTATION_RING_IDS } from "@/lib/sim/rotation";
import { WATER_PROCESSOR_IDS, WATER_DISTRIBUTION_SPUR_IDS } from "@/lib/sim/water";
import { MAINTENANCE_ASSET_IDS } from "@/lib/sim/maintenance";
import type { ViewId, ForceField, SystemCard } from "./types";

// ─── 星图数据（物理坐标见 lib/astro/star-catalog）──────────────

export const STAR_SYSTEMS = CATALOG_STAR_SYSTEMS;

// ─── 导航 ─────────────────────────────────────────────────────

export const NAV_ITEMS: Array<{ id: ViewId; label: string; mark: string }> = [
  { id: "voyage", label: "舰桥", mark: "NAV" },
  { id: "ship", label: "舰务", mark: "SYS" },
  { id: "people", label: "乘员", mark: "CREW" },
  { id: "ai", label: "AI 观察", mark: "AI" },
  { id: "god", label: "人工干预", mark: "EXT" },
];

// ─── 设备 ID 集合 ─────────────────────────────────────────────

export const THRUSTER_ID_SET = new Set<string>(THRUSTER_IDS);
export const FUSION_REACTOR_ID_SET = new Set<string>(FUSION_REACTOR_IDS);
export const COOLANT_PUMP_ID_SET = new Set<string>(COOLANT_PUMP_IDS);
export const HABITAT_THERMAL_DELIVERY_SPUR_ID_SET = new Set<string>(
  HABITAT_THERMAL_DELIVERY_SPUR_IDS,
);
export const ELECTRICAL_LOAD_ID_SET = new Set<string>(ELECTRICAL_LOAD_IDS);
export const ELECTRICAL_BREAKER_ID_SET = new Set<string>(ELECTRICAL_BREAKER_IDS);
export const ELECTRICAL_BATTERY_ID_SET = new Set<string>(ELECTRICAL_BATTERY_IDS);
export const ROTATION_RING_ID_SET = new Set<string>(ROTATION_RING_IDS);
export const AIR_HANDLER_ID_SET = new Set<string>(AIR_HANDLER_IDS);
export const WATER_PROCESSOR_ID_SET = new Set<string>(WATER_PROCESSOR_IDS);
export const WATER_DISTRIBUTION_SPUR_ID_SET = new Set<string>(
  WATER_DISTRIBUTION_SPUR_IDS,
);
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

/** 未联机占位：不得展示虚构 MW / g 读数 */
export const OFFLINE_SYSTEMS: SystemCard[] = [
  {
    name: "聚变电网",
    value: "未联机",
    detail: "等待签发 · 电网遥测未接入",
    load: 0,
    tone: "watch",
  },
  {
    name: "热管理",
    value: "未联机",
    detail: "等待签发 · 冷却遥测未接入",
    load: 0,
    tone: "watch",
  },
  {
    name: "生命保障",
    value: "未联机",
    detail: "等待签发 · 舱压遥测未接入",
    load: 0,
    tone: "watch",
  },
  {
    name: "火炬推进",
    value: "未联机",
    detail: "等待签发 · 推进剂计量未接入",
    load: 0,
    tone: "watch",
  },
  {
    name: "旋转居住环",
    value: "未联机",
    detail: "等待签发 · 环转速遥测未接入",
    load: 0,
    tone: "watch",
  },
  {
    name: "跃迁储能",
    value: "未联机",
    detail: "等待签发 · 跃迁总线未接入",
    load: 0,
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
    model: "配置端点",
    state: "等待最高指令",
    cadence: "自主",
  },
  {
    id: "navigation",
    role: "导航与跃迁",
    name: "北辰",
    model: "配置端点",
    state: "航路待命",
    cadence: "按需",
  },
  {
    id: "engineering",
    role: "工程与能源",
    name: "炉心",
    model: "配置端点",
    state: "系统待命",
    cadence: "按需",
  },
  {
    id: "life-support",
    role: "生命保障",
    name: "青穹",
    model: "配置端点",
    state: "生保待命",
    cadence: "按需",
  },
  {
    id: "medical",
    role: "医疗与休眠",
    name: "白塔",
    model: "配置端点",
    state: "待命",
    cadence: "按需",
  },
  {
    id: "passenger-affairs",
    role: "乘客事务",
    name: "栖居",
    model: "配置端点",
    state: "事务待命",
    cadence: "按需",
  },
  {
    id: "security",
    role: "安保与应急",
    name: "界碑",
    model: "配置端点",
    state: "安保待命",
    cadence: "按需",
  },
  {
    id: "passenger-service",
    role: "乘客服务",
    name: "归栖",
    model: "配置端点",
    state: "服务待命",
    cadence: "按需",
  },
];

// ─── 舰体设计参数 ─────────────────────────────────────────────

/**
 * 设计目标尺度，真相源为 docs/PRODUCT_SPEC.md 5.2。
 * 剖视图几何与舰桥说明必须引用同一组数字，避免界面上出现两个船长。
 */
export const SHIP_DESIGN_LENGTH_M = 900;
export const SHIP_DESIGN_MAX_DIAMETER_M = 480;
export const SHIP_DESIGN_RING_RADIUS_M = 224;

// ─── 其他常量 ─────────────────────────────────────────────────

export const MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE = 8;
export {
  AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
  AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
} from "@/lib/sim/captain-authorized-observation";
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
  WATER_DISTRIBUTION_SPUR_IDS,
  HABITAT_THERMAL_DELIVERY_SPUR_IDS,
  MAINTENANCE_ASSET_IDS,
};
