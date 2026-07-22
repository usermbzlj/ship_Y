"use client";

import type {
  ShipState,
  PassengerHighlightTelemetry,
  KeyPassengerPrivateNote,
} from "../types";
import { formatDuration } from "../utils";
import { StatusPill } from "../components/status-pill";

export function PeopleView({
  state,
  highlights,
  privateNotes,
}: {
  state: ShipState | null;
  highlights: PassengerHighlightTelemetry[];
  privateNotes: KeyPassengerPrivateNote[];
}) {
  const total = state?.population.total ?? 2_120;
  const awake = state?.population.awake ?? 218;
  const hibernating = state?.population.hibernating ?? 1_902;
  const health = (state?.population.averageHealth ?? 0.985) * 100;
  const morale = state?.population.averageMorale ?? 0.82;
  const privateNoteByPassengerId = new Map(
    privateNotes.map((note) => [note.passengerId, note]),
  );
  const displayedPassengers = highlights.map((person) => {
    const privateNote = privateNoteByPassengerId.get(person.passengerId);
    return {
      id: person.passengerId,
      name: person.name,
      role: person.occupation,
      cabin: person.cabinId,
      zoneId: person.zoneId,
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
  return (
    <section className="view-grid people-view" aria-label="乘员状态">
      <div className="panel population-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">POPULATION / 个体持续模拟</span>
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
            {((awake / total) * 100).toFixed(1)}% 清醒
          </span>
          <span className="population-tag tag-sleep">
            {hibernating.toLocaleString("zh-CN")} 休眠
          </span>
          <span className="population-tag tag-care">
            {(state?.population.deceased ?? 0).toLocaleString("zh-CN")} 死亡
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
              {(state?.hibernation.occupiedPods ?? 1_902).toLocaleString("zh-CN")}
            </strong>
          </div>
        </div>
      </div>
      <div className="panel passenger-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">KEY PASSENGERS / 固定关键槽位 32</span>
            <h2>关键乘客观察</h2>
          </div>
        </div>
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
                    {passenger.role} · {passenger.cabin} ·{" "}
                    {passenger.zoneId}
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
