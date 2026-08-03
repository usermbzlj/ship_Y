/**
 * Pure captain decision-trigger priority chain and watch fallback.
 */

import {
  captainHullThreatBlocksJump,
  projectCaptainJumpThermalEstimate,
} from "../sim/captain-observation.ts";
import { isCaptainRoutineDue } from "../sim/captain-schedule.ts";
import type {
  CompartmentTelemetry,
  CoolingTelemetry,
  HullConsequenceTelemetry,
} from "../sim/protocol.ts";
import type { ShipState } from "../sim/index.ts";
import {
  captainWatchTriggerKey,
  type FiredWatch,
} from "./captain-watch.ts";

export type CaptainDecisionControllerRecord = {
  jumpControllerState: ShipState["journey"]["status"];
  completedJumpLogCount: number;
};

export type CaptainDecisionTriggerInput = {
  missionStartAlreadyInvoked: boolean;
  simulationSeconds: number;
  nextCaptainRoutineAtSimulationSeconds: number | null;
  routineSeconds: number;
  urgentWindowSeconds: number;
  hullConsequence: HullConsequenceTelemetry | null | undefined;
  compartments: CompartmentTelemetry | null | undefined;
  cooling: CoolingTelemetry | null | undefined;
  controllerRecord: CaptainDecisionControllerRecord | null;
  observedPowerAlarm: boolean;
  unattendedMaintenanceFaults: ReadonlyArray<{
    assetId: string;
    label?: string;
    condition: string;
  }>;
  requiredChargePerJumpKWh: number;
  totalDistanceLightYears: number;
  completedDistanceLightYears: number;
};

export type CaptainDecisionTriggerResult = {
  triggerKey: string;
  triggerReason: string;
};

export function resolveCaptainDecisionTrigger(
  input: CaptainDecisionTriggerInput,
): CaptainDecisionTriggerResult {
  let triggerKey = "";
  let triggerReason = "";

  if (!input.missionStartAlreadyInvoked) {
    triggerKey = "mission-start";
    triggerReason = "最高指令刚刚生效，需要建立首段航程与清醒计划";
  } else if (
    isCaptainRoutineDue(
      input.simulationSeconds,
      input.nextCaptainRoutineAtSimulationSeconds,
    )
  ) {
    triggerKey = `routine:${input.nextCaptainRoutineAtSimulationSeconds}`;
    triggerReason = "到达舰长自行设定的例行系统信息周期";
  } else if (
    captainHullThreatBlocksJump({
      hullConsequence: input.hullConsequence,
      compartments: input.compartments,
    })
  ) {
    const decisionWindow = Math.floor(
      input.simulationSeconds / input.urgentWindowSeconds,
    );
    const breachCount =
      input.hullConsequence?.activeBreachCount ??
      input.compartments?.activeBreaches ??
      0;
    triggerKey = `hull-threat:${breachCount}:${decisionWindow}`;
    triggerReason =
      input.hullConsequence?.jumpBlockReason ??
      `壳体威胁：活动破口 ${breachCount} 处，跃迁联锁生效；优先隔离并 schedule_hull_repair，禁止 execute_jump`;
  } else if (input.controllerRecord?.jumpControllerState === "ready") {
    const pendingJumpThermal = projectCaptainJumpThermalEstimate({
      thermalBusSensorK:
        input.cooling?.observed.thermalBusTemperatureK ?? null,
      requiredChargePerJumpKWh: input.requiredChargePerJumpKWh,
      remainingDistanceLightYears: Math.max(
        0,
        input.totalDistanceLightYears - input.completedDistanceLightYears,
      ),
    });
    if (pendingJumpThermal && !pendingJumpThermal.clearsInterlock) {
      const decisionWindow = Math.floor(
        input.simulationSeconds / input.urgentWindowSeconds,
      );
      triggerKey = `jump-thermal-block:${decisionWindow}`;
      triggerReason =
        "跃迁储能已就绪，但推进热预测超过主热汇流排安全联锁上限；需先降温/确认冷却，禁止立即 execute_jump";
    } else {
      const decisionWindow = Math.floor(
        input.simulationSeconds / input.routineSeconds,
      );
      triggerKey = `jump-ready:${input.controllerRecord.completedJumpLogCount}:${decisionWindow}`;
      triggerReason =
        input.controllerRecord.completedJumpLogCount === 0
          ? "延迟跃迁控制器记录显示储能达到执行阈值，需要决定是否提交首次跃迁；零次完成记录与完整剩余航程是首次跃迁前的正常状态"
          : "延迟跃迁控制器记录显示储能达到执行阈值，需要决定是否提交下一段跃迁命令";
    }
  } else if (input.observedPowerAlarm) {
    triggerKey = `power-deficit:${Math.floor(input.simulationSeconds / input.urgentWindowSeconds)}`;
    triggerReason = "电网出现未满足负载，需要舰长处置";
  } else if (input.unattendedMaintenanceFaults.length > 0) {
    triggerKey = `maintenance-fault:${input.unattendedMaintenanceFaults
      .map((asset) => asset.assetId)
      .join(",")}:${Math.floor(input.simulationSeconds / input.urgentWindowSeconds)}`;
    triggerReason = `维修诊断总线报告 ${input.unattendedMaintenanceFaults
      .map((asset) => `${asset.label}:${asset.condition}`)
      .join("、")}，均尚无活动维修任务，且同环维修机器人与对应备件当前均可用（可排程）`;
  } else if (
    input.compartments?.observedPressureMinPa !== null &&
    input.compartments?.observedPressureMinPa !== undefined &&
    input.compartments.observedPressureMinPa < 90_000
  ) {
    triggerKey = `pressure-low:${Math.floor(input.simulationSeconds / input.urgentWindowSeconds)}`;
    triggerReason = "至少一个居住压力区的延迟传感读数低于警戒值";
  } else if (
    input.cooling?.observed.averageCoolantTemperatureK !== null &&
    input.cooling?.observed.averageCoolantTemperatureK !== undefined &&
    input.cooling.observed.averageCoolantTemperatureK > 355
  ) {
    triggerKey = `thermal-high:${Math.floor(input.simulationSeconds / input.urgentWindowSeconds)}`;
    triggerReason = "冷却母线温度高于警戒值";
  }

  return { triggerKey, triggerReason };
}

export function applyCaptainWatchTriggerFallback(
  current: CaptainDecisionTriggerResult,
  fired: ReadonlyArray<FiredWatch>,
): CaptainDecisionTriggerResult {
  if (current.triggerKey || fired.length === 0) {
    return current;
  }
  const watchKey = captainWatchTriggerKey(fired);
  if (!watchKey) {
    return current;
  }
  return {
    triggerKey: watchKey,
    triggerReason: `舰长自设观察哨触发：${fired
      .map(
        (item) =>
          `${item.label}${item.comparator === "above" ? "高于" : "低于"}${item.threshold}（观测 ${item.observedValue}）；${item.note}`,
      )
      .join("；")}`,
  };
}
