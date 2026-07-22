"use client";

import { useState } from "react";
import type {
  ShipState,
  ForceField,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  NavigationTelemetry,
  RotationTelemetry,
  WaterRecoveryTelemetry,
  MaintenanceTelemetry,
} from "../types";
import { FORCE_FIELDS } from "../constants";
import { StatusPill } from "../components/status-pill";

export function GodView({
  state,
  compartments,
  cooling,
  electrical,
  navigation,
  rotation,
  waterRecovery,
  maintenance,
  onCausalEvent,
  onOverride,
}: {
  state: ShipState | null;
  compartments: CompartmentTelemetry | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  navigation: NavigationTelemetry | null;
  rotation: RotationTelemetry | null;
  waterRecovery: WaterRecoveryTelemetry | null;
  maintenance: MaintenanceTelemetry | null;
  onCausalEvent: (eventId: string, label: string) => void;
  onOverride: (field: ForceField, value: number) => void;
}) {
  const [fieldId, setFieldId] = useState<string>(FORCE_FIELDS[0].id);
  const selectedField =
    FORCE_FIELDS.find((field) => field.id === fieldId) ?? FORCE_FIELDS[0];
  const [value, setValue] = useState<string>(selectedField.defaultValue);
  const parsedValue = Number(value);
  const valueIsValid = Number.isFinite(parsedValue) && parsedValue >= 0;

  const changeField = (nextId: string) => {
    const next =
      FORCE_FIELDS.find((field) => field.id === nextId) ?? FORCE_FIELDS[0];
    setFieldId(next.id);
    setValue(next.defaultValue);
  };

  return (
    <section className="view-grid god-view" aria-label="人工干预模式">
      <div className="panel god-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow danger">EXTERNAL AUTHORITY / 世界之外</span>
            <h2>人工干预模式</h2>
          </div>
          <StatusPill tone="critical">上帝权限</StatusPill>
        </div>
        <p className="god-intro">
          这里的操作不属于舰长可用能力。所有变化将登记为外部质量、能量或状态注入，
          随后的演化重新交还给物理引擎。
        </p>
        <div className="observer-truth-strip">
          <div>
            <span>世界真值 / 平均舱压</span>
            <strong>
              {state
                ? `${(state.atmosphere.pressurePa / 1_000).toFixed(3)} kPa`
                : "—"}
            </strong>
          </div>
          <div>
            <span>舰载观测 / 延迟均值</span>
            <strong>
              {compartments?.observedPressureAveragePa === null ||
              compartments?.observedPressureAveragePa === undefined
                ? "等待读数"
                : `${(compartments.observedPressureAveragePa / 1_000).toFixed(3)} kPa`}
            </strong>
          </div>
          <div>
            <span>物理实体 / 活动破口</span>
            <strong>{compartments?.activeBreaches ?? 0}</strong>
          </div>
          <div>
            <span>空气处理真值 / A·B 实际风量</span>
            <strong>
              {compartments
                ? compartments.airHandlers.truth
                    .map(
                      (handler) =>
                        `${handler.ring} ${(handler.actualFlowFraction * 100).toFixed(0)}% · ${handler.condition}`,
                    )
                    .join(" / ")
                : "—"}
            </strong>
          </div>
          <div>
            <span>水回收真值 / A·B 实际处理量</span>
            <strong>
              {waterRecovery
                ? waterRecovery.truth.processors
                    .map(
                      (processor) =>
                        `${processor.ring.toUpperCase()} ${(processor.actualThroughputKgPerSecond * 86_400).toFixed(0)} kg/d · ${processor.condition}`,
                    )
                    .join(" / ")
                : "—"}
            </strong>
          </div>
          <div>
            <span>维修真值 / 活动任务与剩余备件</span>
            <strong>
              {maintenance
                ? `${maintenance.activeTasks.length} 项 / ${Object.values(
                    maintenance.inventory,
                  ).reduce(
                    (total, quantity) => total + quantity,
                    0,
                  )} 件`
                : "—"}
            </strong>
          </div>
          <div>
            <span>热网络真值 / 最热点</span>
            <strong>
              {cooling
                ? `${cooling.truth.hottestNodeTemperatureK.toFixed(2)} K`
                : "—"}
            </strong>
          </div>
          <div>
            <span>电网真值 / 发电与缺供</span>
            <strong>
              {electrical
                ? `${(electrical.truth.generationPowerKw / 1_000).toFixed(1)} / ${(electrical.truth.unservedPowerKw / 1_000).toFixed(1)} MW`
                : "—"}
            </strong>
          </div>
          <div>
            <span>导航真值 / 动量闭合误差</span>
            <strong>
              {navigation
                ? `${navigation.truth.linearMomentumClosureErrorKgMPerS.toExponential(2)} kg·m/s`
                : "—"}
            </strong>
          </div>
          <div>
            <span>旋转真值 / A·B 居住重力</span>
            <strong>
              {rotation
                ? rotation.truth.rings
                    .map(
                      (ring) =>
                        `${ring.id === "ring-a" ? "A" : "B"} ${ring.artificialGravityG.toFixed(4)} g`,
                    )
                    .join(" · ")
                : "—"}
            </strong>
          </div>
          <div>
            <span>旋转真值 / 净相对角动量</span>
            <strong>
              {rotation
                ? `${rotation.truth.netRelativeRingAngularMomentumKgM2PerS.toExponential(2)} kg·m²/s`
                : "—"}
            </strong>
          </div>
          <div>
            <span>旋转真值 / 轴承与结构振动</span>
            <strong>
              {rotation
                ? rotation.truth.rings
                    .map(
                      (ring) =>
                        `${ring.id === "ring-a" ? "A" : "B"} ${ring.bearingCondition} · ${ring.vibrationMmPerS.toFixed(2)} mm/s`,
                    )
                    .join(" / ")
                : "—"}
            </strong>
          </div>
        </div>
        <div className="intervention-grid">
          {[
            ["micrometeoroid", "微流星体撞击", "向外壳注入动量并形成等效微破口"],
            ["coolant-pump-seizure", "冷却泵卡死", "将真实泵转子锁为停转并由回路重新计算流量"],
            ["stellar-flare", "恒星耀斑", "注入外部辐射与粒子沉积产生的热负荷"],
            ["fusion-reactor-trip", "聚变堆保护跳闸", "触发真实堆保护与发电机断路器断开"],
            ["ring-bearing-degradation", "居住环轴承劣化", "令A环真实轴承进入劣化状态，后续振动、摩擦与废热由物理链路演化"],
            ["air-handler-trip", "空气处理机跳停", "令A环处理机实体跳停，后续环路混合与CO₂积累由分舱物理演化"],
            ["water-processor-trip", "水回收机跳停", "令A环水回收机实体跳停，后续净水消耗、废水积累与浓盐水产物由水网络演化"],
            ["passenger-emergency", "乘客急症", "从持久化乘员名册选择清醒个体并写入病例"],
          ].map(([eventId, label, detail]) => (
            <button
              className="event-button"
              key={label}
              onClick={() => onCausalEvent(eventId, label)}
              type="button"
            >
              <span>触发事件</span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="panel override-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">DIRECT OVERRIDE</span>
            <h2>原力覆写</h2>
          </div>
        </div>
        <label>
          目标字段
          <select
            value={fieldId}
            onChange={(event) => changeField(event.target.value)}
          >
            {FORCE_FIELDS.map((field) => (
              <option value={field.id} key={field.id}>
                {field.label} / {field.unit}
              </option>
            ))}
          </select>
        </label>
        <label>
          新数值
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
          />
        </label>
        {!valueIsValid && (
          <small className="field-error">仅接受有限的非负数值</small>
        )}
        <button
          className="override-button"
          onClick={() => onOverride(selectedField, parsedValue)}
          type="button"
          disabled={!valueIsValid}
        >
          写入外部状态
        </button>
        <div className="observer-lock">
          <span>LLM 内部状态</span>
          <strong>仅观测 · 禁止覆写</strong>
        </div>
      </div>
    </section>
  );
}
