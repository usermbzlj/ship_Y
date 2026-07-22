/**
 * 程序化事件生成器 — 基于仿真时间和确定性种子自动产生事件。
 * 在协调器层运行，通过上帝干预接口注入因果事件或直接产生叙事事件。
 *
 * 事件类型：
 * - 设备磨损/故障（基于运行时间）
 * - 微流星体撞击（随机）
 * - 传感器漂移/故障
 * - 乘客社会事件（基于压力/信任阈值）
 * - 休眠并发症
 * - 环境/辐射事件
 */

export type ProceduralEventSeverity = "info" | "watch" | "warning" | "critical";

export interface ProceduralEvent {
  id: string;
  type: string;
  severity: ProceduralEventSeverity;
  source: string;
  message: string;
  simulationSeconds: number;
  /** 如果需要上帝干预，提供 intervention eventType */
  interventionEventType?: string;
}

interface EventScheduleEntry {
  type: string;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  severity: ProceduralEventSeverity;
  source: string;
  messages: string[];
  interventionEventType?: string;
  /** 最早触发时间（仿真秒） */
  earliestSeconds: number;
}

/** 事件调度表 — 定义各类事件的最短/最长间隔和消息池 */
const EVENT_SCHEDULE: EventScheduleEntry[] = [
  {
    type: "micrometeoroid",
    minIntervalSeconds: 72_000, // 20h
    maxIntervalSeconds: 259_200, // 72h
    severity: "warning",
    source: "外壳传感器阵列",
    messages: [
      "微流星体撞击外壳，局部声学传感器检测到异常振动。",
      "高速微粒穿透外层防护，碎片屏蔽层记录到冲击信号。",
      "船体外壳遭受微流星体轰击，密封完整性监测已启动。",
    ],
    interventionEventType: "micrometeoroid",
    earliestSeconds: 14_400, // 4h after start
  },
  {
    type: "sensor-drift",
    minIntervalSeconds: 43_200, // 12h
    maxIntervalSeconds: 172_800, // 48h
    severity: "info",
    source: "数字孪生估算器",
    messages: [
      "一组温度传感器出现零点漂移，数字孪生已标记为降级读数。",
      "压力传感器校准偏差超出容许范围，维护窗口已排入建议队列。",
      "姿态参考陀螺仪检测到微小偏差，导航滤波器已自动补偿。",
    ],
    earliestSeconds: 7_200,
  },
  {
    type: "passenger-social",
    minIntervalSeconds: 28_800, // 8h
    maxIntervalSeconds: 86_400, // 24h
    severity: "info",
    source: "乘客事务部",
    messages: [
      "B 环公共区发生乘客纠纷，安保机器人已到场调解。",
      "一批清醒乘客联名请求增加娱乐区供电配额。",
      "农业环志愿者报告作物生长异常，请求生态农艺师复核。",
      "乘客自发组织了一场关于航程意义的公开讨论。",
      "休眠舱家属探视请求排队已超过 48 小时。",
      "独立记者再次申请访问舰内事故记录，乘客事务部已转交舰长。",
    ],
    earliestSeconds: 3_600,
  },
  {
    type: "hibernation-complication",
    minIntervalSeconds: 86_400, // 24h
    maxIntervalSeconds: 345_600, // 96h
    severity: "watch",
    source: "医疗与休眠部",
    messages: [
      "一名休眠乘客出现体温调节异常，医疗机器人已调整舱温参数。",
      "休眠舱 A-12 区检测到微量冷凝水积聚，循环系统已自动除湿。",
      "一名长期休眠者的肌肉萎缩指标接近干预阈值，已排入唤醒评估。",
    ],
    earliestSeconds: 43_200,
  },
  {
    type: "equipment-wear",
    minIntervalSeconds: 172_800, // 48h
    maxIntervalSeconds: 604_800, // 168h (7 days)
    severity: "watch",
    source: "工程与能源部",
    messages: [
      "冷却回路 B 泵轴承振动频谱出现早期磨损特征，建议排入维护窗口。",
      "空气处理机 A 吸附剂饱和度接近 80%，更换窗口建议在 72 小时内。",
      "水回收机 B 膜组件通量下降 3%，化学清洗已排入预防性维护计划。",
      "聚变模块 3 号磁约束线圈温度略高于基线，热管理已增加局部冷却。",
    ],
    interventionEventType: "coolant-pump-seizure",
    earliestSeconds: 86_400,
  },
  {
    type: "radiation-event",
    minIntervalSeconds: 259_200, // 72h
    maxIntervalSeconds: 864_000, // 240h (10 days)
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
    minIntervalSeconds: 86_400, // 24h
    maxIntervalSeconds: 432_000, // 120h (5 days)
    severity: "watch",
    source: "配电系统",
    messages: [
      "B 母线出现短暂电压波动，保护系统已监测但未触发切除。",
      "电池组 A 荷电状态因负载瞬变出现 2% 偏差，已自动修正。",
      "一台聚变模块爬坡响应略慢于指令，工程部门已标记观察。",
    ],
    earliestSeconds: 43_200,
  },
];

/** 确定性伪随机数生成器（基于种子） */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

/**
 * 程序化事件调度器。
 * 在协调器中每个仿真步调用 `check()`，返回新触发的事件列表。
 */
export class ProceduralEventScheduler {
  private nextTriggerAt: Map<string, number> = new Map();
  private random: () => number;
  private eventCounter = 0;

  constructor(seed: number) {
    this.random = seededRandom(seed);
    // 初始化每类事件的首次触发时间
    for (const entry of EVENT_SCHEDULE) {
      const interval =
        entry.minIntervalSeconds +
        this.random() * (entry.maxIntervalSeconds - entry.minIntervalSeconds);
      this.nextTriggerAt.set(entry.type, entry.earliestSeconds + interval);
    }
  }

  /**
   * 检查当前仿真时间是否有事件触发。
   * 返回新触发的事件列表（可能为空）。
   */
  check(simulationSeconds: number): ProceduralEvent[] {
    const triggered: ProceduralEvent[] = [];

    for (const entry of EVENT_SCHEDULE) {
      const nextAt = this.nextTriggerAt.get(entry.type);
      if (nextAt === undefined || simulationSeconds < nextAt) continue;

      // 触发事件
      this.eventCounter++;
      const messageIndex = Math.floor(this.random() * entry.messages.length);
      triggered.push({
        id: `proc-${entry.type}-${this.eventCounter}`,
        type: entry.type,
        severity: entry.severity,
        source: entry.source,
        message: entry.messages[messageIndex],
        simulationSeconds,
        interventionEventType: entry.interventionEventType,
      });

      // 计算下次触发时间
      const interval =
        entry.minIntervalSeconds +
        this.random() * (entry.maxIntervalSeconds - entry.minIntervalSeconds);
      this.nextTriggerAt.set(entry.type, simulationSeconds + interval);
    }

    return triggered;
  }

  /** 重置调度器（新航程时调用） */
  reset(seed: number) {
    this.random = seededRandom(seed);
    this.eventCounter = 0;
    this.nextTriggerAt.clear();
    for (const entry of EVENT_SCHEDULE) {
      const interval =
        entry.minIntervalSeconds +
        this.random() * (entry.maxIntervalSeconds - entry.minIntervalSeconds);
      this.nextTriggerAt.set(entry.type, entry.earliestSeconds + interval);
    }
  }
}
