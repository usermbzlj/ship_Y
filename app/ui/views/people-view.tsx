"use client";

import type {
  ShipState,
  PassengerHighlightTelemetry,
  KeyPassengerPrivateNote,
  CompartmentTelemetry,
  PassengerSocietySnapshot,
} from "../types";
import {
  zoneCatalogEntry,
  ZONE_ROLE_LABELS_ZH,
  type ZoneId,
  type ZoneRole,
} from "@/lib/sim/compartments";
import { formatDuration } from "../utils";
import { StatusPill } from "../components/status-pill";

const RUMOR_DISPLAY_LIMIT = 8;

/** Prefer compartment zone telemetry labelZh/role; fall back to zone catalog. */
function zoneRoleLabelZh(
  zoneId: string,
  zones: CompartmentTelemetry["zones"] | undefined,
): string | null {
  const telemetry = zones?.find((zone) => zone.zoneId === zoneId);
  if (telemetry?.labelZh) {
    return telemetry.labelZh;
  }
  if (telemetry?.role && telemetry.role in ZONE_ROLE_LABELS_ZH) {
    return ZONE_ROLE_LABELS_ZH[telemetry.role as ZoneRole];
  }
  try {
    return zoneCatalogEntry(zoneId as ZoneId).labelZh;
  } catch {
    return null;
  }
}

function formatRelativeAgo(
  nowSimulationSeconds: number,
  atSimulationSeconds: number,
): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor(nowSimulationSeconds - atSimulationSeconds),
  );
  const totalMinutes = Math.floor(elapsedSeconds / 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days} 天 ${hours} 小时前`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟前`;
  }
  if (minutes > 0) {
    return `${minutes} 分钟前`;
  }
  return "刚刚";
}

function RumorBoard({
  passengerSociety,
  simulationSeconds,
  missionStarted,
}: {
  passengerSociety: PassengerSocietySnapshot;
  simulationSeconds: number;
  missionStarted: boolean;
}) {
  const rumors = passengerSociety.rumors
    .slice()
    .sort(
      (left, right) =>
        right.createdAtSimulationSeconds - left.createdAtSimulationSeconds,
    )
    .slice(0, RUMOR_DISPLAY_LIMIT);

  return (
    <div className="rumor-board">
      <div className="rumor-board-head">
        <div>
          <span className="eyebrow">CIRCULATING</span>
          <strong>乘客传言</strong>
        </div>
        <span className="rumor-unverified">未经证实</span>
      </div>
      {rumors.length === 0 ? (
        <div className="rumor-empty panel-note">
          <p>尚无流传中的乘客传言。</p>
          <p>
            {missionStarted
              ? "关键乘客向同区带同伴分享见闻后，未经证实的传言会出现在这里，并在 72 小时内衰减。"
              : "等待签发 · 关键乘客分享见闻后，未经证实的传言将显示在此。"}
          </p>
        </div>
      ) : (
        <div className="rumor-list">
          {rumors.map((rumor) => (
            <article className="rumor-item" key={rumor.rumorId}>
              <div className="rumor-item-meta">
                <strong>{rumor.originDisplayName}</strong>
                <span>{rumor.zoneId}</span>
                <span className="rumor-unverified-chip">未经证实</span>
                <span>
                  {formatRelativeAgo(
                    simulationSeconds,
                    rumor.createdAtSimulationSeconds,
                  )}
                </span>
              </div>
              <p className="rumor-text">{rumor.text}</p>
              <span className="rumor-hear">
                {rumor.hearCount.toLocaleString("zh-CN")} 人听到 ·{" "}
                {formatDuration(rumor.createdAtSimulationSeconds)}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function PeopleView({
  state,
  highlights,
  privateNotes,
  compartments = null,
  passengerSociety,
  simulationSeconds,
  missionStarted,
}: {
  state: ShipState | null;
  highlights: PassengerHighlightTelemetry[];
  privateNotes: KeyPassengerPrivateNote[];
  compartments?: CompartmentTelemetry | null;
  passengerSociety: PassengerSocietySnapshot;
  simulationSeconds: number;
  missionStarted: boolean;
}) {
  const privateNoteByPassengerId = new Map(
    privateNotes.map((note) => [note.passengerId, note]),
  );
  const zones = compartments?.zones;
  const displayedPassengers = highlights.map((person) => {
    const privateNote = privateNoteByPassengerId.get(person.passengerId);
    return {
      id: person.passengerId,
      name: person.name,
      role: person.occupation,
      cabin: person.cabinId,
      zoneId: person.zoneId,
      zoneRoleLabel: zoneRoleLabelZh(person.zoneId, zones),
      zoneCondition: person.zoneCondition,
      zoneObservation:
        person.lifeState === "hibernating"
          ? "休眠舱内 · 分配区非实时位置"
          : person.lifeState === "deceased"
            ? "个人区域记录已封存"
            : person.zoneObservedPressurePa === null
              ? "区域遥测等待中"
              : `${(person.zoneObservedPressurePa / 1_000).toFixed(1)} kPa · ${person.zoneObservationAgeSeconds?.toFixed(0) ?? "?"}s`,
      state:
        person.lifeState === "awake"
          ? "清醒"
          : person.lifeState === "hibernating"
            ? "休眠"
            : "死亡",
      trust: Math.round(person.trust * 100),
      note:
        person.lifeState === "deceased"
          ? "个人记录已封存"
          : privateNote
            ? `私人终端 · ${formatDuration(privateNote.createdAtSimulationSeconds)}：${privateNote.text.slice(0, 220)}`
            : `身体 ${(person.physicalHealth * 100).toFixed(0)}% · 压力 ${(person.stress * 100).toFixed(0)}% · 等待私人终端轮询`,
    };
  });

  if (state == null) {
    return (
      <section className="view-grid people-view habitat-surface" aria-label="乘员状态">
        <div className="panel population-panel is-offline">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">POPULATION</span>
              <h2>乘员遥测未联机</h2>
            </div>
            <StatusPill tone="watch">未联机</StatusPill>
          </div>
          <div className="population-orbit">
            <div className="population-core">
              <strong>—</strong>
              <span>等待签发</span>
            </div>
            <div className="orbit-ring orbit-one" />
            <div className="orbit-ring orbit-two" />
            <span className="population-tag tag-awake">清醒 · 未联机</span>
            <span className="population-tag tag-sleep">休眠 · 未联机</span>
            <span className="population-tag tag-care">死亡 · 未联机</span>
          </div>
          <div className="population-metrics">
            <div>
              <span>群体健康</span>
              <strong>未联机</strong>
            </div>
            <div>
              <span>社会压力</span>
              <strong>未联机</strong>
            </div>
            <div>
              <span>休眠舱占用</span>
              <strong>未联机</strong>
            </div>
          </div>
          <p className="panel-note population-offline-note">
            等待签发 · 人口与健康遥测未接入。任务启动后将显示真实乘员计数，不会使用占位人数。
          </p>
        </div>
        <div className="panel passenger-panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">KEY PASSENGERS</span>
              <h2>关键乘客观察</h2>
            </div>
          </div>
          <RumorBoard
            passengerSociety={passengerSociety}
            simulationSeconds={simulationSeconds}
            missionStarted={missionStarted}
          />
          <div className="passenger-list">
            <div className="passenger-empty-note panel-note">
              <strong>关键槽位已预留 · 列表为空</strong>
              <p>
                32 个固定关键乘客槽位已登记，当前尚无遥测入库。任务启动后，当乘员清醒时将开始私人终端轮询；在此之前本列表保持空白，不会显示占位乘客。
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const total = state.population.total;
  const awake = state.population.awake;
  const hibernating = state.population.hibernating;
  const health = state.population.averageHealth * 100;
  const morale = state.population.averageMorale;

  return (
    <section className="view-grid people-view habitat-surface" aria-label="乘员状态">
      <div className="panel population-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">POPULATION</span>
            <h2>{total.toLocaleString("zh-CN")} 名乘员</h2>
          </div>
          <StatusPill
            tone={
              health < 70
                ? "critical"
                : health < 90
                  ? "watch"
                  : "nominal"
            }
          >
            {health < 70 ? "医疗告警" : health < 90 ? "需要关注" : "医疗稳定"}
          </StatusPill>
        </div>
        <div className="population-orbit">
          <div className="population-core">
            <strong>{awake.toLocaleString("zh-CN")}</strong>
            <span>当前清醒</span>
          </div>
          <div className="orbit-ring orbit-one" />
          <div className="orbit-ring orbit-two" />
          <span className="population-tag tag-awake">
            {total > 0 ? ((awake / total) * 100).toFixed(1) : "0.0"}% 清醒
          </span>
          <span className="population-tag tag-sleep">
            {hibernating.toLocaleString("zh-CN")} 休眠
          </span>
          <span className="population-tag tag-care">
            {state.population.deceased.toLocaleString("zh-CN")} 死亡
          </span>
        </div>
        <div className="population-metrics">
          <div>
            <span>群体健康</span>
            <strong>{health.toFixed(1)}%</strong>
          </div>
          <div>
            <span>社会压力</span>
            <strong>
              {morale > 0.75 ? "中低" : morale > 0.5 ? "偏高" : "危险"} ·{" "}
              {(morale * 100).toFixed(0)}%
            </strong>
          </div>
          <div>
            <span>休眠舱占用</span>
            <strong>
              {state.hibernation.occupiedPods.toLocaleString("zh-CN")}
            </strong>
          </div>
        </div>
      </div>
      <div className="panel passenger-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">KEY PASSENGERS</span>
            <h2>关键乘客观察</h2>
          </div>
        </div>
        <RumorBoard
          passengerSociety={passengerSociety}
          simulationSeconds={simulationSeconds}
          missionStarted
        />
        <div className="passenger-list">
          {displayedPassengers.length === 0 ? (
            <div className="passenger-empty-note panel-note">
              <strong>关键槽位已预留 · 列表为空</strong>
              <p>
                32 个固定关键乘客槽位已登记，当前尚无遥测入库。任务启动后，当乘员清醒时将开始私人终端轮询；在此之前本列表保持空白，不会显示占位乘客。
              </p>
            </div>
          ) : (
            displayedPassengers.map((passenger) => (
              <article className="passenger-row" key={passenger.id}>
                <div className="avatar">{passenger.name.slice(0, 1)}</div>
                <div>
                  <strong>{passenger.name}</strong>
                  <span>
                    {passenger.role} · {passenger.cabin} · {passenger.zoneId}
                    {passenger.zoneRoleLabel
                      ? ` · ${passenger.zoneRoleLabel}`
                      : ""}
                  </span>
                  <p>{passenger.note}</p>
                </div>
                <div className="passenger-state">
                  <StatusPill
                    tone={
                      passenger.state === "死亡" ||
                      (passenger.state === "清醒" &&
                        passenger.zoneCondition === "critical")
                        ? "critical"
                        : passenger.state === "清醒" &&
                            passenger.zoneCondition === "nominal"
                          ? "nominal"
                          : "watch"
                    }
                  >
                    {passenger.state === "清醒" &&
                    passenger.zoneCondition === "critical"
                      ? "清醒 · 区域危险"
                      : passenger.state === "清醒" &&
                          passenger.zoneCondition === "watch"
                        ? "清醒 · 区域关注"
                        : passenger.state}
                  </StatusPill>
                  <span>信任 {passenger.trust}</span>
                  <span>
                    {passenger.state === "休眠"
                      ? "休眠舱生命保障"
                      : passenger.state === "死亡"
                        ? "区域记录封存"
                        : `区域 ${
                            passenger.zoneCondition === "nominal"
                              ? "正常"
                              : passenger.zoneCondition === "watch"
                                ? "关注"
                                : passenger.zoneCondition === "critical"
                                  ? "危险"
                                  : "离线"
                          }`}
                  </span>
                  <span>{passenger.zoneObservation}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
