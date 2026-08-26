/**
 * Authoritative procedural event scheduler — lives in the Worker, enters saves.
 * Physical injections are declared separately from narrative-only timeline noise.
 */

export const PROCEDURAL_WORLD_SNAPSHOT_VERSION = 1 as const;

export type ProceduralEventSeverity = "info" | "watch" | "warning" | "critical";

export interface ProceduralWorldEvent {
  id: string;
  type: string;
  severity: ProceduralEventSeverity;
  source: string;
  message: string;
  simulationSeconds: number;
  /** When set, Worker should apply a real intervention. */
  interventionEventType?: string;
  /** Narrative-only events never mutate physics. */
  narrativeOnly: boolean;
}

export interface ProceduralWorldSnapshot {
  snapshotVersion: typeof PROCEDURAL_WORLD_SNAPSHOT_VERSION;
  seed: number;
  rngState: number;
  eventCounter: number;
  nextTriggerAt: Record<string, number>;
}

interface EventScheduleEntry {
  type: string;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  severity: ProceduralEventSeverity;
  source: string;
  messages: string[];
  interventionEventType?: string;
  earliestSeconds: number;
}

const EVENT_SCHEDULE: EventScheduleEntry[] = [
  {
    type: "micrometeoroid",
    minIntervalSeconds: 72_000,
    maxIntervalSeconds: 259_200,
    severity: "warning",
    source: "外壳传感器阵列",
    messages: [
      "微流星体撞击外壳，局部声学传感器检测到异常振动。",
      "高速微粒穿透外层防护，碎片屏蔽层记录到冲击信号。",
      "船体外壳遭受微流星体轰击，密封完整性监测已启动。",
    ],
    interventionEventType: "micrometeoroid",
    earliestSeconds: 14_400,
  },
  {
    type: "sensor-drift",
    minIntervalSeconds: 43_200,
    maxIntervalSeconds: 172_800,
    severity: "info",
    source: "数字孪生估算器",
    messages: [
      "一组舱区温度传感器出现零点漂移，数字孪生已将其标记为降级读数。",
      "舱区压力传感器校准偏差超出容许范围，受影响探头已降级。",
      "舱区氧分压传感器检测到微小偏差，维护窗口已排入建议队列。",
    ],
    interventionEventType: "sensor-drift",
    earliestSeconds: 7_200,
  },
  {
    type: "passenger-social",
    minIntervalSeconds: 28_800,
    maxIntervalSeconds: 86_400,
    severity: "info",
    source: "乘客事务部",
    messages: [
      "【叙事记录·无即时物理注入】B 环公共区发生乘客纠纷，安保机器人已到场调解。",
      "【叙事记录·无即时物理注入】一批清醒乘客联名请求增加娱乐区供电配额。",
      "【叙事记录·无即时物理注入】农业环志愿者报告作物观察异常，请求农艺复核（产量模型仍按舰长运营账本结算）。",
      "【叙事记录·无即时物理注入】乘客自发组织了一场关于航程意义的公开讨论。",
      "【叙事记录·无即时物理注入】休眠舱家属探视请求排队已超过 48 小时。",
      "【叙事记录·无即时物理注入】独立记者再次申请访问舰内事故记录，乘客事务部已转交舰长。",
    ],
    earliestSeconds: 3_600,
  },
  {
    type: "hibernation-complication",
    minIntervalSeconds: 86_400,
    maxIntervalSeconds: 345_600,
    severity: "watch",
    source: "医疗与休眠部",
    messages: [
      "休眠馈线 A（hibernation-a）出现间歇性欠压，保护已跳开断路器；本地储备开始放电。",
      "休眠舱 A-12 区冷凝异常伴随 hibernation-a 馈线跳闸，本地骑越储备已接入。",
      "休眠馈线 B（hibernation-b）检测到维持功率跌落，断路器已保护跳开。",
    ],
    interventionEventType: "hibernation-complication",
    earliestSeconds: 43_200,
  },
  {
    type: "equipment-wear",
    minIntervalSeconds: 172_800,
    maxIntervalSeconds: 604_800,
    severity: "watch",
    source: "工程与能源部",
    messages: [
      "冷却回路 A 泵轴承振动频谱出现早期磨损特征，建议排入维护窗口。",
      "冷却回路 B 泵密封面磨损加重，实际流量已开始间歇性跌落。",
      "主冷却泵润滑油光谱检出金属磨粒上升，泵组健康度已降级。",
      // AHU / water processor / fusion coil wear remain narrative-only future work.
    ],
    // Honest binding: only the coolant-pump path is physically modeled today.
    interventionEventType: "coolant-pump-seizure",
    earliestSeconds: 86_400,
  },
  {
    type: "radiation-event",
    minIntervalSeconds: 259_200,
    maxIntervalSeconds: 864_000,
    severity: "warning",
    source: "外部环境监测",
    messages: [
      "恒星活动区检测到异常粒子通量上升，辐射屏蔽已自动调整姿态。",
      "穿越一片稀薄星际尘埃云，外壳侵蚀率略有上升。",
      "宇宙射线通量出现短期峰值，休眠舱屏蔽层已确认完整。",
    ],
    interventionEventType: "stellar-flare",
    earliestSeconds: 172_800,
  },
  {
    type: "power-fluctuation",
    minIntervalSeconds: 86_400,
    maxIntervalSeconds: 432_000,
    severity: "watch",
    source: "配电系统",
    messages: [
      "B 母线出现电压扰动，bus-b 电压传感器已降级，聚变模块 3 目标出力已临时降额。",
      "电池组 A 因负载瞬变进入降级工况，对应荷电状态传感器读数已标记不可靠。",
      "聚变模块 2 爬坡响应异常，保护已切除该堆，待工程复位断路器后可恢复。",
    ],
    interventionEventType: "power-fluctuation",
    earliestSeconds: 43_200,
  },
];

/** Event types the live schedule knows how to trigger and consume. */
const SCHEDULE_TYPES = new Set(EVENT_SCHEDULE.map((entry) => entry.type));

function hashSeedString(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class ProceduralWorldScheduler {
  private seedValue: number;
  private rngState: number;
  private eventCounter = 0;
  private nextTriggerAt = new Map<string, number>();

  constructor(seed: string | number) {
    this.seedValue =
      typeof seed === "number" ? seed >>> 0 : hashSeedString(seed);
    this.rngState = this.seedValue || 1;
    this.reseedSchedule();
  }

  private nextRandom(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private reseedSchedule(): void {
    this.nextTriggerAt.clear();
    for (const entry of EVENT_SCHEDULE) {
      const interval =
        entry.minIntervalSeconds +
        this.nextRandom() *
          (entry.maxIntervalSeconds - entry.minIntervalSeconds);
      this.nextTriggerAt.set(entry.type, entry.earliestSeconds + interval);
    }
  }

  nextEventSimulationSeconds(): number | null {
    let earliest = Number.POSITIVE_INFINITY;
    for (const [type, value] of this.nextTriggerAt) {
      // Only advertise types check() can actually consume. A restored snapshot
      // may carry a renamed/removed key whose past due time would otherwise make
      // the Worker's step loop spin forever (check() never clears it).
      if (!SCHEDULE_TYPES.has(type)) continue;
      if (Number.isFinite(value)) earliest = Math.min(earliest, value);
    }
    return Number.isFinite(earliest) ? earliest : null;
  }

  check(simulationSeconds: number): ProceduralWorldEvent[] {
    const triggered: ProceduralWorldEvent[] = [];
    for (const entry of EVENT_SCHEDULE) {
      const nextAt = this.nextTriggerAt.get(entry.type);
      if (
        nextAt === undefined ||
        simulationSeconds + 1e-6 < nextAt
      ) {
        continue;
      }

      this.eventCounter += 1;
      const messageIndex = Math.floor(
        this.nextRandom() * entry.messages.length,
      );
      triggered.push({
        id: `proc-${entry.type}-${this.eventCounter}`,
        type: entry.type,
        severity: entry.severity,
        source: entry.source,
        message: entry.messages[messageIndex] ?? entry.messages[0]!,
        simulationSeconds: nextAt,
        interventionEventType: entry.interventionEventType,
        narrativeOnly: entry.interventionEventType === undefined,
      });

      const interval =
        entry.minIntervalSeconds +
        this.nextRandom() *
          (entry.maxIntervalSeconds - entry.minIntervalSeconds);
      this.nextTriggerAt.set(entry.type, nextAt + interval);
    }
    return triggered;
  }

  reset(seed: string | number): void {
    this.seedValue =
      typeof seed === "number" ? seed >>> 0 : hashSeedString(seed);
    this.rngState = this.seedValue || 1;
    this.eventCounter = 0;
    this.reseedSchedule();
  }

  snapshot(): ProceduralWorldSnapshot {
    const nextTriggerAt: Record<string, number> = {};
    for (const [key, value] of this.nextTriggerAt) {
      nextTriggerAt[key] = value;
    }
    return {
      snapshotVersion: PROCEDURAL_WORLD_SNAPSHOT_VERSION,
      seed: this.seedValue,
      rngState: this.rngState,
      eventCounter: this.eventCounter,
      nextTriggerAt,
    };
  }

  static restore(snapshot: ProceduralWorldSnapshot): ProceduralWorldScheduler {
    if (snapshot.snapshotVersion !== PROCEDURAL_WORLD_SNAPSHOT_VERSION) {
      throw new Error(
        `unsupported procedural world snapshot version ${String(snapshot.snapshotVersion)}`,
      );
    }
    const scheduler = new ProceduralWorldScheduler(snapshot.seed);
    scheduler.rngState = snapshot.rngState >>> 0;
    scheduler.eventCounter = snapshot.eventCounter;
    scheduler.nextTriggerAt = new Map(
      Object.entries(snapshot.nextTriggerAt)
        // Drop keys the current schedule no longer defines so they cannot wedge
        // the step loop; missing known keys are re-seeded by the constructor.
        .filter(([key]) => SCHEDULE_TYPES.has(key))
        .map(([key, value]) => [key, Number(value)]),
    );
    return scheduler;
  }
}
