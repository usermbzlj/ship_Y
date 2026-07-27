import type { ShipState } from "../sim/index.ts";
import type { RingControlMode } from "../sim/rotation.ts";
import type { ReactorMode, BatteryControlMode } from "../sim/electrical.ts";
import type { ZoneId, AirHandlerId } from "../sim/compartments.ts";
import { AIR_HANDLER_IDS } from "../sim/compartments.ts";
import {
  HEAT_EXCHANGER_IDS,
  RADIATOR_IDS,
  COOLANT_PUMP_IDS,
  HABITAT_THERMAL_DELIVERY_SPUR_IDS,
  type CoolantPumpId,
  type HabitatThermalDeliverySpurId,
} from "../sim/cooling.ts";
import {
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_LOAD_IDS,
  FUSION_REACTOR_IDS,
  type ElectricalBatteryId,
  type ElectricalBreakerId,
  type ElectricalLoadId,
  type FusionReactorId,
} from "../sim/electrical.ts";
import { THRUSTER_IDS, type ThrusterId } from "../sim/navigation.ts";
import { ROTATION_RING_IDS, type RotationRingId } from "../sim/rotation.ts";
import {
  WATER_PROCESSOR_IDS,
  WATER_DISTRIBUTION_SPUR_IDS,
  type WaterProcessorId,
  type WaterDistributionSpurId,
} from "../sim/water.ts";
import {
  MAINTENANCE_PART_IDS,
  MAINTENANCE_ROBOT_IDS,
  MAINTENANCE_ASSET_IDS,
  type MaintenanceAssetId,
} from "../sim/maintenance.ts";
import {
  ACTIVE_SENSOR_PACKAGE_IDS,
  AGRICULTURE_BAY_IDS,
  DUTY_SHIFT_IDS,
  FABRICATOR_IDS,
  OXYGEN_GENERATOR_IDS,
  ORDER_PRIORITIES,
  REMOTE_ASSET_IDS,
  SECURITY_TEAM_IDS,
  SHIP_DEPARTMENT_IDS,
} from "../sim/captain-operations.ts";
import type { SimulationWorkerCommand } from "../sim/protocol.ts";
import type { LlmToolDefinition } from "./index.ts";
import {
  RECORD_CAPTAIN_LOG_TOOL_NAME,
  RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA,
} from "./captain-journal.ts";
import {
  SET_WATCH_CONDITION_TOOL_NAME,
  SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA,
} from "./captain-watch.ts";
import {
  FILE_DISSENT_TOOL_NAME,
  FILE_DISSENT_TOOL_INPUT_SCHEMA,
} from "./department-standing.ts";
import {
  FILE_GRIEVANCE_TOOL_NAME,
  FILE_GRIEVANCE_TOOL_INPUT_SCHEMA,
  SHARE_RUMOR_TOOL_NAME,
  SHARE_RUMOR_TOOL_INPUT_SCHEMA,
} from "./passenger-society.ts";

const THRUSTER_ID_SET = new Set<string>(THRUSTER_IDS);
const FUSION_REACTOR_ID_SET = new Set<string>(FUSION_REACTOR_IDS);
const COOLANT_PUMP_ID_SET = new Set<string>(COOLANT_PUMP_IDS);
const HABITAT_THERMAL_DELIVERY_SPUR_ID_SET = new Set<string>(
  HABITAT_THERMAL_DELIVERY_SPUR_IDS,
);
const ELECTRICAL_LOAD_ID_SET = new Set<string>(ELECTRICAL_LOAD_IDS);
const ELECTRICAL_BREAKER_ID_SET = new Set<string>(ELECTRICAL_BREAKER_IDS);
const ELECTRICAL_BATTERY_ID_SET = new Set<string>(ELECTRICAL_BATTERY_IDS);
const ROTATION_RING_ID_SET = new Set<string>(ROTATION_RING_IDS);
const AIR_HANDLER_ID_SET = new Set<string>(AIR_HANDLER_IDS);
const WATER_PROCESSOR_ID_SET = new Set<string>(WATER_PROCESSOR_IDS);
const WATER_DISTRIBUTION_SPUR_ID_SET = new Set<string>(
  WATER_DISTRIBUTION_SPUR_IDS,
);
const MAINTENANCE_ASSET_ID_SET = new Set<string>(MAINTENANCE_ASSET_IDS);

const RING_CONTROL_MODES = ["speed-hold", "coast", "brake"] as const;
const RING_CONTROL_MODE_SET = new Set<string>(RING_CONTROL_MODES);
const BATTERY_CONTROL_MODES = [
  "automatic",
  "charge-only",
  "discharge-only",
  "standby",
] as const;
const BATTERY_CONTROL_MODE_SET = new Set<string>(BATTERY_CONTROL_MODES);
const REACTOR_MODES = ["online", "hot-standby", "offline"] as const;
const REACTOR_MODE_SET = new Set<string>(REACTOR_MODES);

export type ShipWorldCommand = Extract<
  SimulationWorkerCommand,
  { type: "ship-command" }
>["command"];

export type CaptainWorldToolParseResult =
  | { ok: true; command: ShipWorldCommand }
  | { ok: false; reason: string };

// 基础工具 enum 直接引用 lib 中的 readonly 元组；断言与原先组件内未标注数组的上下文类型等价。
const BASE_CAPTAIN_WORLD_TOOLS = [
  {
    name: "execute_jump",
    description:
      "向真实跃迁控制器提交一次0.1至5光年的启动命令。首次跃迁前零次完成记录与完整剩余航程正常，不要求先有亚光速推进或历史跃迁；设备会以当前储能、供电、冷却、姿态和推进器状态执行确定性联锁，成功后才更新航程并产生耗能与废热。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["distanceLightYears"],
      properties: {
        distanceLightYears: {
          type: "number",
          minimum: 0.1,
          maximum: 5,
        },
      },
    },
  },
  {
    name: "set_awake_target",
    description:
      "向医疗与休眠系统提交清醒人数目标；系统只会按舱位、人员和小时级医疗流程分批排程，不会直接改写人员状态。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["targetAwake"],
      properties: {
        targetAwake: {
          type: "integer",
          minimum: 0,
          maximum: 2120,
        },
      },
    },
  },
  {
    name: "isolate_pressure_zone",
    description:
      "关闭指定压力区相连的真实舱门、风管和隔离阀，限制泄漏传播。该命令不会修复破口，且错误隔离会切断通行与通风。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["zoneId"],
      properties: {
        zoneId: {
          type: "string",
          pattern: "^[AB]-(0[1-9]|1[0-9]|2[0-4])$",
        },
      },
    },
  },
  {
    name: "set_air_handler_control",
    description:
      "设置A或B空气处理机的循环风量指令并投入或旁路CO₂吸附器。真实风量由本机状态和对应生命保障馈线供电决定；吸附器只会从所属环路的实体舱室气体中移除高于控制设定点的CO₂。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "airHandlerId",
        "commandedFlowFraction",
        "scrubberEnabled",
      ],
      properties: {
        airHandlerId: {
          type: "string",
          enum: AIR_HANDLER_IDS,
        },
        commandedFlowFraction: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        scrubberEnabled: { type: "boolean" },
      },
    },
  },
  {
    name: "set_water_processor_control",
    description:
      "设置A或B水回收机的处理量指令。废水先经过主处理，再经过浓盐水二级回收；真实处理量受本机状态、对应生命保障馈线、废水库存和净水罐余量约束，不能直接生成净水。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "processorId",
        "commandedThroughputFraction",
      ],
      properties: {
        processorId: {
          type: "string",
          enum: WATER_PROCESSOR_IDS,
        },
        commandedThroughputFraction: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
      },
    },
  },
  {
    name: "configure_water_distribution_spur",
    description:
      "配置A或B环配水支路阀门开度，或将降级/卡死关闭的支路修复为 nominal。有效送达分数=开度指令×工况倍率；不能注入 stuck-closed/degraded（那是上帝/环境故障）。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["spurId"],
      properties: {
        spurId: {
          type: "string",
          enum: WATER_DISTRIBUTION_SPUR_IDS,
        },
        commandedOpenFraction: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        condition: {
          type: "string",
          enum: ["nominal"],
        },
      },
    },
  },
  {
    name: "configure_habitat_thermal_delivery_spur",
    description:
      "配置A或B环居住热送达支路阀门开度，或将降级/卡死关闭的支路修复为 nominal。有效送达分数=开度指令×工况倍率，缩放该环舱热泵冷却；不能注入 stuck-closed/degraded（那是上帝/环境故障）。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["spurId"],
      properties: {
        spurId: {
          type: "string",
          enum: HABITAT_THERMAL_DELIVERY_SPUR_IDS,
        },
        commandedOpenFraction: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        condition: {
          type: "string",
          enum: ["nominal"],
        },
      },
    },
  },
  {
    name: "schedule_maintenance",
    description:
      "为诊断为非 nominal 的固定设备创建真实维修任务。系统会锁定并消耗对应备件，分配同环维修机器人和一名清醒合格乘员；只有工业馈线有服务且乘员保持清醒时才累计工时，完成后物理设备才会被检修，不能直接改写设备状态。A/B 每环仅有 2 台维修机器人：若同环机器人全部占用，或对应备件库存为 0，本次排程会被直接拒绝，不会免费排队等待。调用前请检查 maintenanceDiagnostics.assets[].scheduleFeasibility 与 robots 的空闲状态；当 blockReason 为 ring-robot-unavailable 或 part-inventory-exhausted 时不要重复提交同一设备的排程，应等运力或备件恢复后再试。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["assetId"],
      properties: {
        assetId: {
          type: "string",
          enum: MAINTENANCE_ASSET_IDS,
        },
      },
    },
  },
  {
    name: "schedule_thruster_pulse",
    description:
      "向固定安装的真实推进器排程一次脉冲。系统会依据推力方向、安装力臂、比冲、推进剂余量和故障状态积分六自由度运动；不可直接指定速度、位置或姿态。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "thrusterId",
        "throttleFraction",
        "durationSeconds",
        "startDelaySeconds",
      ],
      properties: {
        thrusterId: {
          type: "string",
          enum: THRUSTER_IDS,
        },
        throttleFraction: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        durationSeconds: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 600,
        },
        startDelaySeconds: {
          type: "number",
          minimum: 0,
          maximum: 3_600,
        },
      },
    },
  },
  {
    name: "schedule_thruster_maneuver",
    description:
      "以单一原子事务排程1至18个推进器脉冲，适合用成对或成组推进器实现近似纯平移、俯仰、偏航或滚转。所有脉冲仍由固定安装位置、方向、推力、比冲和推进剂积分；任一项无效则整组拒绝。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pulses"],
      properties: {
        pulses: {
          type: "array",
          minItems: 1,
          maxItems: 18,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "thrusterId",
              "throttleFraction",
              "durationSeconds",
              "startDelaySeconds",
            ],
            properties: {
              thrusterId: {
                type: "string",
                enum: THRUSTER_IDS,
              },
              throttleFraction: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              durationSeconds: {
                type: "number",
                exclusiveMinimum: 0,
                maximum: 600,
              },
              startDelaySeconds: {
                type: "number",
                minimum: 0,
                maximum: 3_600,
              },
            },
          },
        },
      },
    },
  },
  {
    name: "set_reactor_target",
    description:
      "设置一个聚变发电模块的目标电功率（每台额定225000 kW）。在线模块将按爬坡率接近目标；保护跳闸或未在线的模块不会凭空输出。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["reactorId", "targetOutputKw"],
      properties: {
        reactorId: {
          type: "string",
          enum: FUSION_REACTOR_IDS,
        },
        targetOutputKw: {
          type: "number",
          minimum: 0,
          maximum: 225_000,
        },
      },
    },
  },
  {
    name: "set_reactor_mode",
    description:
      "把一个未跳闸的聚变模块切换为在线、热备或离线。切为在线不会瞬间产生额定功率，输出仍按目标值和爬坡率变化；跳闸模块不能用此命令复位。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["reactorId", "mode"],
      properties: {
        reactorId: {
          type: "string",
          enum: FUSION_REACTOR_IDS,
        },
        mode: {
          type: "string",
          enum: REACTOR_MODES,
        },
      },
    },
  },
  {
    name: "set_cooling_pump_speed",
    description:
      "设置A或B冷却回路泵的转速指令。真实流量和耗电仍受泵体状况与回路物理约束；停泵会因热量持续积累而产生后果。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "pumpId",
        "commandedSpeedFraction",
      ],
      properties: {
        pumpId: {
          type: "string",
          enum: COOLANT_PUMP_IDS,
        },
        commandedSpeedFraction: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
      },
    },
  },
  {
    name: "set_electrical_load_enabled",
    description:
      "投入或退出一个真实配电负载。退出生命保障、休眠、冷却或居住负载会产生物理后果；投入也不保证母线有足够功率。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["loadId", "enabled"],
      properties: {
        loadId: {
          type: "string",
          enum: ELECTRICAL_LOAD_IDS,
        },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "set_electrical_breaker",
    description:
      "向实体断路器发出合闸或分闸指令，以改变双母线、发电、储能和负载拓扑。保护跳闸锁存不会被普通合闸指令绕过。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["breakerId", "commandedClosed"],
      properties: {
        breakerId: {
          type: "string",
          enum: ELECTRICAL_BREAKER_IDS,
        },
        commandedClosed: { type: "boolean" },
      },
    },
  },
  {
    name: "set_battery_mode",
    description:
      "设置A或B储能组为自动、仅充电、仅放电或待机。实际功率受荷电量、额定功率、故障与母线平衡限制。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["batteryId", "mode"],
      properties: {
        batteryId: {
          type: "string",
          enum: ELECTRICAL_BATTERY_IDS,
        },
        mode: {
          type: "string",
          enum: BATTERY_CONTROL_MODES,
        },
      },
    },
  },
  {
    name: "set_habitat_ring_control",
    description:
      "操作A或B反向旋转居住环的真实驱动器。可设闭环转速保持、自由滑行或机械制动；实际转速、人工重力、舰体反作用、耗电和废热均由电机、轴承与角动量守恒计算，不可直接指定重力。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "ringId",
        "controlMode",
        "targetRelativeRpm",
      ],
      properties: {
        ringId: {
          type: "string",
          enum: ROTATION_RING_IDS,
        },
        controlMode: {
          type: "string",
          enum: RING_CONTROL_MODES,
        },
        targetRelativeRpm: {
          type: "number",
          minimum: -12,
          maximum: 12,
        },
      },
    },
  },
] as readonly LlmToolDefinition[];

const EXTENDED_CAPTAIN_WORLD_TOOLS: readonly LlmToolDefinition[] = [
  {
    name: "revise_mission",
    description: "修改目的地、任务目标和航路，或宣布继续、返航、改道、放弃任务。返航会自动以原出发地为目的地；这是舰务命令，不涉及存档或时间控制。",
    inputSchema: { type: "object", additionalProperties: false, required: ["disposition", "destination", "objective", "route", "totalDistanceLightYears", "totalLegs"], properties: {
      disposition: { type: "string", enum: ["continue", "return", "divert", "abandon"] }, destination: { type: "string" }, objective: { type: "string" },
      route: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, required: ["id", "label", "distanceFromPreviousLightYears"], properties: { id: { type: "string" }, label: { type: "string" }, distanceFromPreviousLightYears: { type: "number", minimum: 0 } } } },
      totalDistanceLightYears: { type: "number", exclusiveMinimum: 0, maximum: 100000 }, totalLegs: { type: "integer", minimum: 1, maximum: 10000 },
    } },
  },
  {
    name: "manage_department_order",
    description: "创建、变更、取消部门命令或要求立即回报。期限、工时和定期回报按世界时间连续推进。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action"], properties: {
      action: { type: "string", enum: ["create", "change", "cancel", "request-report"] }, orderId: { type: "string" }, departmentId: { type: "string", enum: [...SHIP_DEPARTMENT_IDS] }, title: { type: "string" }, instruction: { type: "string" }, priority: { type: "string", enum: [...ORDER_PRIORITIES] }, deadlineSeconds: { type: "number", exclusiveMinimum: 0, maximum: 2592000 }, estimatedWorkSeconds: { type: "number", exclusiveMinimum: 0, maximum: 2592000 }, reportingIntervalSeconds: { type: "number", minimum: 60, maximum: 86400 }, reason: { type: "string" },
    } },
  },
  {
    name: "publish_communication",
    description: "向乘客公告、解释政策、答复申诉或发送外部通信；可立即或延迟送达。",
    inputSchema: { type: "object", additionalProperties: false, required: ["communicationKind", "audienceOrTarget", "subject", "message"], properties: {
      communicationKind: { type: "string", enum: ["announcement", "policy-explanation", "grievance-response", "external-message"] }, audienceOrTarget: { type: "string" }, subject: { type: "string" }, message: { type: "string" }, deliveryDelaySeconds: { type: "number", minimum: 0 }, relatedGrievanceId: { type: "string" },
    } },
  },
  {
    name: "manage_crew_assignment",
    description: "调整个人部门、岗位、班次、值班区或部门负责人。",
    inputSchema: { type: "object", additionalProperties: false, required: ["personId", "departmentId", "role", "shiftId", "dutyZoneId", "departmentHead"], properties: {
      personId: { type: "string" }, departmentId: { type: "string", enum: [...SHIP_DEPARTMENT_IDS] }, role: { type: "string" }, shiftId: { type: "string", enum: [...DUTY_SHIFT_IDS] }, dutyZoneId: { type: ["string", "null"] }, departmentHead: { type: "boolean" },
    } },
  },
  {
    name: "manage_person",
    description: "指定个人唤醒、休眠、分诊、治疗、转移或疏散；设备流程与任务工时完成前不会直接跳变状态。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action", "personId"], properties: {
      action: { type: "string", enum: ["wake", "hibernate", "triage", "treat", "transfer", "evacuate"] }, personId: { type: "string" }, zoneId: { type: "string", pattern: "^[AB]-(0[1-9]|1[0-9]|2[0-4])$" }, triageLevel: { type: "string", enum: ["none", "routine", "urgent", "critical", "expectant"] }, treatmentPlan: { type: "string" }, priority: { type: "string", enum: [...ORDER_PRIORITIES] },
    } },
  },
  {
    name: "manage_security",
    description: "部署安保、设置门禁、拘留或释放个人、立案调查或保护区域。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action", "reason"], properties: {
      action: { type: "string", enum: ["deploy", "set-access", "detain", "release", "investigate", "protect"] }, teamId: { type: "string", enum: [...SECURITY_TEAM_IDS] }, zoneId: { type: "string" }, connectionId: { type: "string" }, accessMode: { type: "string", enum: ["open", "restricted", "sealed"] }, personId: { type: "string" }, caseId: { type: "string" }, reason: { type: "string" },
    } },
  },
  {
    name: "manage_logistics",
    description: "管理食品配给、农业、货物、舱位、备件制造和替代批准。制造会消耗原料并累计真实工时。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action"], properties: {
      action: { type: "string", enum: ["set-ration", "configure-agriculture", "move-cargo", "allocate-cabin", "manufacture-part", "approve-substitution"] }, rationKgPerPersonDay: { type: "number", minimum: 0, maximum: 1.5 }, agricultureBayId: { type: "string", enum: [...AGRICULTURE_BAY_IDS] }, crop: { type: "string" }, intensityFraction: { type: "number", minimum: 0, maximum: 1 }, cargoId: { type: "string" }, quantity: { type: "number", exclusiveMinimum: 0 }, destinationZoneId: { type: "string" }, personId: { type: "string" }, cabinId: { type: "string" }, fabricatorId: { type: "string", enum: [...FABRICATOR_IDS] }, partId: { type: "string", enum: [...MAINTENANCE_PART_IDS] }, assetId: { type: "string", enum: [...MAINTENANCE_ASSET_IDS] }, deratingFraction: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" },
    } },
  },
  {
    name: "set_compartment_connection",
    description: "开关或细分设置普通舱门、风管或隔离阀开度；实际开度仍受卡滞故障约束。",
    inputSchema: { type: "object", additionalProperties: false, required: ["connectionId", "commandedOpenFraction"], properties: { connectionId: { type: "string" }, commandedOpenFraction: { type: "number", minimum: 0, maximum: 1 } } },
  },
  {
    name: "schedule_hull_repair",
    description: "对已存在的船体破口创建封堵任务，立即消耗一套密封材料，工时完成后才移除破口。",
    inputSchema: { type: "object", additionalProperties: false, required: ["breachId", "priority"], properties: { breachId: { type: "string" }, priority: { type: "string", enum: [...ORDER_PRIORITIES] } } },
  },
  {
    name: "set_thermal_control",
    description: "控制散热器展开/冷却剂阀或换热器导通率。",
    inputSchema: { type: "object", additionalProperties: false, required: ["targetType", "controlFraction"], properties: { targetType: { type: "string", enum: ["radiator", "heat-exchanger"] }, radiatorId: { type: "string", enum: [...RADIATOR_IDS] }, heatExchangerId: { type: "string", enum: [...HEAT_EXCHANGER_IDS] }, controlFraction: { type: "number", minimum: 0, maximum: 1 } } },
  },
  {
    name: "set_atmosphere_supply",
    description: "向指定压力区补充或从中回收氧气、氮气、二氧化碳或水蒸气；舰载储备（atmosphereReserveKg）和舱区质量账同时变化。制氧产物只在储备中，须本命令才进入舱区。",
    inputSchema: { type: "object", additionalProperties: false, required: ["zoneId", "gas", "massKg", "operation"], properties: { zoneId: { type: "string" }, gas: { type: "string", enum: ["oxygen", "nitrogen", "carbonDioxide", "waterVapor"] }, massKg: { type: "number", exclusiveMinimum: 0 }, operation: { type: "string", enum: ["add", "remove"] } } },
  },
  {
    name: "set_oxygen_production",
    description: "投入或停用A/B环制氧机并设置目标产氧率。制氧连续消耗实体净水，产生氧气与氢副产物入账舰载储备（atmosphereReserveKg），不会自动进入舱区气体；舱区补给须另发 set_atmosphere_supply。实际产量受生命保障供电影响。",
    inputSchema: { type: "object", additionalProperties: false, required: ["generatorId", "enabled", "targetProductionKgPerHour"], properties: { generatorId: { type: "string", enum: [...OXYGEN_GENERATOR_IDS] }, enabled: { type: "boolean" }, targetProductionKgPerHour: { type: "number", minimum: 0, maximum: 8 } } },
  },
  {
    name: "distribute_water",
    description: "设置压力区饮水额度，或在A/B环净水罐之间转运实体水量。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action"], properties: { action: { type: "string", enum: ["set-zone-allocation", "transfer-between-rings"] }, zoneId: { type: "string" }, kgPerAwakePersonDay: { type: "number", minimum: 0, maximum: 12 }, fromRing: { type: "string", enum: ["a", "b"] }, toRing: { type: "string", enum: ["a", "b"] }, massKg: { type: "number", minimum: 0 } } },
  },
  {
    name: "reset_protection",
    description: "复位反应堆或断路器保护跳闸锁存；复位后仍保持安全的热备/分闸状态。",
    inputSchema: { type: "object", additionalProperties: false, required: ["targetType"], properties: { targetType: { type: "string", enum: ["reactor", "breaker"] }, reactorId: { type: "string", enum: [...FUSION_REACTOR_IDS] }, breakerId: { type: "string", enum: [...ELECTRICAL_BREAKER_IDS] } } },
  },
  {
    name: "manage_maintenance_task",
    description: "取消维修、调整优先级或重新分配乘员/维修机器人。取消不会凭空退回已投入备件。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action", "taskId"], properties: { action: { type: "string", enum: ["cancel", "set-priority", "reassign"] }, taskId: { type: "string" }, priority: { type: "string", enum: [...ORDER_PRIORITIES] }, crewId: { type: "string" }, robotId: { type: "string", enum: [...MAINTENANCE_ROBOT_IDS] }, reason: { type: "string" } } },
  },
  {
    name: "manage_sensor_operation",
    description: "改变传感器包的实体采样周期，或发起需要工时才能生成报告的主动扫描。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action", "packageId"], properties: { action: { type: "string", enum: ["set-frequency", "active-scan"] }, packageId: { type: "string", enum: [...ACTIVE_SENSOR_PACKAGE_IDS] }, sampleIntervalSeconds: { type: "number", minimum: 1, maximum: 86400 }, target: { type: "string" }, durationSeconds: { type: "number", exclusiveMinimum: 0, maximum: 2592000 }, priority: { type: "string", enum: [...ORDER_PRIORITIES] } } },
  },
  {
    name: "manage_remote_asset",
    description: "部署、回收或改派探测器/无人机。部署与回收按世界时间累计工时，改派要求资产已部署。",
    inputSchema: { type: "object", additionalProperties: false, required: ["assetId", "action", "mission", "target"], properties: { assetId: { type: "string", enum: [...REMOTE_ASSET_IDS] }, action: { type: "string", enum: ["deploy", "recover", "retask"] }, mission: { type: "string" }, target: { type: "string" } } },
  },
  {
    name: "set_power_allocation",
    description: "设置任一实体负载的最大需求比例，作为后续控制器请求的硬上限。",
    inputSchema: { type: "object", additionalProperties: false, required: ["loadId", "maximumDemandFraction"], properties: { loadId: { type: "string", enum: [...ELECTRICAL_LOAD_IDS] }, maximumDemandFraction: { type: "number", minimum: 0, maximum: 1 } } },
  },
];

/** 基础 + 扩展合并后的单一真相源；顺序与原先 [...内联基础, ...EXTENDED] 一致。 */
export const CAPTAIN_WORLD_TOOLS: readonly LlmToolDefinition[] = [
  ...BASE_CAPTAIN_WORLD_TOOLS,
  ...EXTENDED_CAPTAIN_WORLD_TOOLS,
];

export const CAPTAIN_CONSULTATION_TOOL: LlmToolDefinition = {
  name: "consult_departments",
  description:
    "自主选择一个或多个部门进行1至3轮会议。世界在会议期间保持冻结；各轮报告会返回舰长，随后舰长再作最终决策。此工具不能控制存档、时间倍率或上帝模式。",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["departmentIds", "question", "rounds"],
    properties: {
      departmentIds: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        uniqueItems: true,
        items: { type: "string", enum: [...SHIP_DEPARTMENT_IDS] },
      },
      question: { type: "string" },
      rounds: { type: "integer", minimum: 1, maximum: 3 },
    },
  },
};

export const RECORD_CAPTAIN_LOG_TOOL: LlmToolDefinition = {
  name: RECORD_CAPTAIN_LOG_TOOL_NAME,
  description:
    "写入一条私人航行志，记录本轮心声、判断与未决事项。跨周期记忆只来自航行志；每回合决策必须调用一次。",
  inputSchema: RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA as unknown as LlmToolDefinition["inputSchema"],
};

export const SET_WATCH_CONDITION_TOOL: LlmToolDefinition = {
  name: SET_WATCH_CONDITION_TOOL_NAME,
  description:
    "在授权观测边界内设置一条观察哨；条件满足时会再次唤醒你。触发一次后自动失效，若仍要监视需重新设置。",
  inputSchema: SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA as unknown as LlmToolDefinition["inputSchema"],
};

export const FILE_DISSENT_TOOL: LlmToolDefinition = {
  name: FILE_DISSENT_TOOL_NAME,
  description:
    "留下一条正式部门异议记录。异议会进入舰长异议账本，不构成否决权，也不能改写世界；仅在确有专业分歧时调用。",
  inputSchema: FILE_DISSENT_TOOL_INPUT_SCHEMA as unknown as LlmToolDefinition["inputSchema"],
};

export const FILE_PASSENGER_GRIEVANCE_TOOL: LlmToolDefinition = {
  name: FILE_GRIEVANCE_TOOL_NAME,
  description:
    "向舰务申诉队列提交一条个人申诉。这会进入乘客事务处理流程，不是直接命令飞船。",
  inputSchema: FILE_GRIEVANCE_TOOL_INPUT_SCHEMA as unknown as LlmToolDefinition["inputSchema"],
};

export const SHARE_PASSENGER_RUMOR_TOOL: LlmToolDefinition = {
  name: SHARE_RUMOR_TOOL_NAME,
  description:
    "把你听到或想到的话传给附近同伴。传言可能被当真，也可能是错的；不要编造舰桥机密。",
  inputSchema: SHARE_RUMOR_TOOL_INPUT_SCHEMA as unknown as LlmToolDefinition["inputSchema"],
};

export function parseCaptainWorldToolCall(
  toolCall: { name: string; arguments: unknown },
  journeyStatus: ShipState["journey"]["status"],
  remainingDistance: number,
  interlocks?: {
    jumpBlocked?: boolean;
    jumpBlockReason?: string | null;
    jumpThermalClears?: boolean | null;
    jumpThermalBlockReason?: string | null;
  },
): CaptainWorldToolParseResult {
  const argumentsObject =
    typeof toolCall.arguments === "object" &&
    toolCall.arguments !== null
      ? (toolCall.arguments as Record<string, unknown>)
      : {};

  if (toolCall.name === "execute_jump") {
    if (interlocks?.jumpBlocked) {
      return {
        ok: false,
        reason:
          interlocks.jumpBlockReason ?? "壳体威胁联锁禁止跃迁",
      };
    }
    if (interlocks?.jumpThermalClears === false) {
      return {
        ok: false,
        reason:
          interlocks.jumpThermalBlockReason ??
          "推进热预测超过主热汇流排安全联锁上限",
      };
    }
    if (journeyStatus !== "ready") {
      return {
        ok: false,
        reason: "跃迁控制器尚未进入 ready 状态",
      };
    }
    const requested = argumentsObject.distanceLightYears;
    if (
      typeof requested !== "number" ||
      !Number.isFinite(requested) ||
      requested < 0.1 ||
      requested > 5 ||
      remainingDistance < 0.1
    ) {
      return {
        ok: false,
        reason: "distanceLightYears 必须在 0.1 至 5 光年范围内",
      };
    }
    return {
      ok: true,
      command: {
        kind: "execute-jump",
        actorAgentId: "captain",
        distanceLightYears: Math.min(requested, remainingDistance),
      },
    };
  }

  if (toolCall.name === "set_awake_target") {
    const targetAwake = argumentsObject.targetAwake;
    if (
      typeof targetAwake !== "number" ||
      !Number.isSafeInteger(targetAwake) ||
      targetAwake < 0 ||
      targetAwake > 2_120
    ) {
      return {
        ok: false,
        reason: "targetAwake 必须是 0 至 2120 的整数",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-awake-target",
        actorAgentId: "captain",
        targetAwake,
      },
    };
  }

  if (toolCall.name === "isolate_pressure_zone") {
    const zoneId = argumentsObject.zoneId;
    if (
      typeof zoneId !== "string" ||
      !/^[AB]-(0[1-9]|1[0-9]|2[0-4])$/.test(zoneId)
    ) {
      return {
        ok: false,
        reason: "zoneId 必须是 A-01 至 B-24 的固定压力区",
      };
    }
    return {
      ok: true,
      command: {
        kind: "isolate-pressure-zone",
        actorAgentId: "captain",
        zoneId: zoneId as ZoneId,
      },
    };
  }

  if (toolCall.name === "set_air_handler_control") {
    const airHandlerId = argumentsObject.airHandlerId;
    const commandedFlowFraction =
      argumentsObject.commandedFlowFraction;
    const scrubberEnabled = argumentsObject.scrubberEnabled;
    if (
      typeof airHandlerId !== "string" ||
      !AIR_HANDLER_ID_SET.has(airHandlerId) ||
      typeof commandedFlowFraction !== "number" ||
      !Number.isFinite(commandedFlowFraction) ||
      commandedFlowFraction < 0 ||
      commandedFlowFraction > 1 ||
      typeof scrubberEnabled !== "boolean"
    ) {
      return {
        ok: false,
        reason: "空气处理机 ID、循环风量或吸附器开关无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-air-handler-control",
        actorAgentId: "captain",
        airHandlerId: airHandlerId as AirHandlerId,
        commandedFlowFraction,
        scrubberEnabled,
      },
    };
  }

  if (toolCall.name === "set_water_processor_control") {
    const processorId = argumentsObject.processorId;
    const commandedThroughputFraction =
      argumentsObject.commandedThroughputFraction;
    if (
      typeof processorId !== "string" ||
      !WATER_PROCESSOR_ID_SET.has(processorId) ||
      typeof commandedThroughputFraction !== "number" ||
      !Number.isFinite(commandedThroughputFraction) ||
      commandedThroughputFraction < 0 ||
      commandedThroughputFraction > 1
    ) {
      return {
        ok: false,
        reason: "水回收机 ID 或处理量指令无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-water-processor-control",
        actorAgentId: "captain",
        processorId: processorId as WaterProcessorId,
        commandedThroughputFraction,
      },
    };
  }

  if (toolCall.name === "configure_water_distribution_spur") {
    const spurId = argumentsObject.spurId;
    const commandedOpenFraction = argumentsObject.commandedOpenFraction;
    const condition = argumentsObject.condition;
    const hasOpenFraction = commandedOpenFraction !== undefined;
    const hasCondition = condition !== undefined;
    if (
      typeof spurId !== "string" ||
      !WATER_DISTRIBUTION_SPUR_ID_SET.has(spurId)
    ) {
      return { ok: false, reason: "配水支路 ID 无效" };
    }
    if (!hasOpenFraction && !hasCondition) {
      return {
        ok: false,
        reason: "需提供 commandedOpenFraction 和/或 condition",
      };
    }
    if (
      hasOpenFraction &&
      (typeof commandedOpenFraction !== "number" ||
        !Number.isFinite(commandedOpenFraction) ||
        commandedOpenFraction < 0 ||
        commandedOpenFraction > 1)
    ) {
      return { ok: false, reason: "配水支路开度指令无效" };
    }
    if (hasCondition && condition !== "nominal") {
      return {
        ok: false,
        reason: "船员只能将配水支路工况修复为 nominal；故障注入需上帝干预",
      };
    }
    return {
      ok: true,
      command: {
        kind: "configure-water-distribution-spur",
        actorAgentId: "captain",
        spurId: spurId as WaterDistributionSpurId,
        ...(hasOpenFraction ? { commandedOpenFraction } : {}),
        ...(hasCondition ? { condition: "nominal" as const } : {}),
      },
    };
  }

  if (toolCall.name === "configure_habitat_thermal_delivery_spur") {
    const spurId = argumentsObject.spurId;
    const commandedOpenFraction = argumentsObject.commandedOpenFraction;
    const condition = argumentsObject.condition;
    const hasOpenFraction = commandedOpenFraction !== undefined;
    const hasCondition = condition !== undefined;
    if (
      typeof spurId !== "string" ||
      !HABITAT_THERMAL_DELIVERY_SPUR_ID_SET.has(spurId)
    ) {
      return { ok: false, reason: "热送达支路 ID 无效" };
    }
    if (!hasOpenFraction && !hasCondition) {
      return {
        ok: false,
        reason: "需提供 commandedOpenFraction 和/或 condition",
      };
    }
    if (
      hasOpenFraction &&
      (typeof commandedOpenFraction !== "number" ||
        !Number.isFinite(commandedOpenFraction) ||
        commandedOpenFraction < 0 ||
        commandedOpenFraction > 1)
    ) {
      return { ok: false, reason: "热送达支路开度指令无效" };
    }
    if (hasCondition && condition !== "nominal") {
      return {
        ok: false,
        reason: "船员只能将热送达支路工况修复为 nominal；故障注入需上帝干预",
      };
    }
    return {
      ok: true,
      command: {
        kind: "configure-habitat-thermal-delivery-spur",
        actorAgentId: "captain",
        spurId: spurId as HabitatThermalDeliverySpurId,
        ...(hasOpenFraction ? { commandedOpenFraction } : {}),
        ...(hasCondition ? { condition: "nominal" as const } : {}),
      },
    };
  }

  if (toolCall.name === "schedule_maintenance") {
    const assetId = argumentsObject.assetId;
    if (
      typeof assetId !== "string" ||
      !MAINTENANCE_ASSET_ID_SET.has(assetId)
    ) {
      return {
        ok: false,
        reason: "assetId 必须是固定维修资产 ID",
      };
    }
    return {
      ok: true,
      command: {
        kind: "schedule-maintenance",
        actorAgentId: "captain",
        assetId: assetId as MaintenanceAssetId,
      },
    };
  }

  if (toolCall.name === "schedule_thruster_pulse") {
    const thrusterId = argumentsObject.thrusterId;
    const throttleFraction = argumentsObject.throttleFraction;
    const durationSeconds = argumentsObject.durationSeconds;
    const startDelaySeconds = argumentsObject.startDelaySeconds;
    if (
      typeof thrusterId !== "string" ||
      !THRUSTER_ID_SET.has(thrusterId) ||
      typeof throttleFraction !== "number" ||
      !Number.isFinite(throttleFraction) ||
      throttleFraction < 0 ||
      throttleFraction > 1 ||
      typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > 600 ||
      typeof startDelaySeconds !== "number" ||
      !Number.isFinite(startDelaySeconds) ||
      startDelaySeconds < 0 ||
      startDelaySeconds > 3_600
    ) {
      return {
        ok: false,
        reason: "推进器、节流、持续时间或启动延迟超出控制器边界",
      };
    }
    return {
      ok: true,
      command: {
        kind: "schedule-thruster-pulse",
        actorAgentId: "captain",
        thrusterId: thrusterId as ThrusterId,
        throttleFraction,
        durationSeconds,
        startDelaySeconds,
      },
    };
  }

  if (toolCall.name === "schedule_thruster_maneuver") {
    const rawPulses = argumentsObject.pulses;
    if (
      !Array.isArray(rawPulses) ||
      rawPulses.length === 0 ||
      rawPulses.length > 18
    ) {
      return {
        ok: false,
        reason: "pulses 必须包含 1 至 18 个推进器脉冲",
      };
    }
    const pulses = rawPulses.flatMap((rawPulse) => {
      if (typeof rawPulse !== "object" || rawPulse === null) {
        return [];
      }
      const pulse = rawPulse as Record<string, unknown>;
      const thrusterId = pulse.thrusterId;
      const throttleFraction = pulse.throttleFraction;
      const durationSeconds = pulse.durationSeconds;
      const startDelaySeconds = pulse.startDelaySeconds;
      if (
        typeof thrusterId !== "string" ||
        !THRUSTER_ID_SET.has(thrusterId) ||
        typeof throttleFraction !== "number" ||
        !Number.isFinite(throttleFraction) ||
        throttleFraction < 0 ||
        throttleFraction > 1 ||
        typeof durationSeconds !== "number" ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > 600 ||
        typeof startDelaySeconds !== "number" ||
        !Number.isFinite(startDelaySeconds) ||
        startDelaySeconds < 0 ||
        startDelaySeconds > 3_600
      ) {
        return [];
      }
      return [
        {
          thrusterId: thrusterId as ThrusterId,
          throttleFraction,
          durationSeconds,
          startDelaySeconds,
        },
      ];
    });
    if (pulses.length !== rawPulses.length) {
      return {
        ok: false,
        reason: "机动计划中至少一个推进器脉冲参数无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "schedule-thruster-maneuver",
        actorAgentId: "captain",
        pulses,
      },
    };
  }

  if (toolCall.name === "set_reactor_target") {
    const reactorId = argumentsObject.reactorId;
    const targetOutputKw = argumentsObject.targetOutputKw;
    if (
      typeof reactorId !== "string" ||
      !FUSION_REACTOR_ID_SET.has(reactorId) ||
      typeof targetOutputKw !== "number" ||
      !Number.isFinite(targetOutputKw) ||
      targetOutputKw < 0 ||
      targetOutputKw > 225_000
    ) {
      return {
        ok: false,
        reason: "反应堆 ID 或目标功率超出设备边界",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-reactor-target",
        actorAgentId: "captain",
        reactorId: reactorId as FusionReactorId,
        targetOutputKw,
      },
    };
  }

  if (toolCall.name === "set_reactor_mode") {
    const reactorId = argumentsObject.reactorId;
    const mode = argumentsObject.mode;
    if (
      typeof reactorId !== "string" ||
      !FUSION_REACTOR_ID_SET.has(reactorId) ||
      typeof mode !== "string" ||
      !REACTOR_MODE_SET.has(mode)
    ) {
      return {
        ok: false,
        reason: "反应堆 ID 或运行模式无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-reactor-mode",
        actorAgentId: "captain",
        reactorId: reactorId as FusionReactorId,
        mode: mode as ReactorMode,
      },
    };
  }

  if (toolCall.name === "set_cooling_pump_speed") {
    const pumpId = argumentsObject.pumpId;
    const commandedSpeedFraction =
      argumentsObject.commandedSpeedFraction;
    if (
      typeof pumpId !== "string" ||
      !COOLANT_PUMP_ID_SET.has(pumpId) ||
      typeof commandedSpeedFraction !== "number" ||
      !Number.isFinite(commandedSpeedFraction) ||
      commandedSpeedFraction < 0 ||
      commandedSpeedFraction > 1
    ) {
      return {
        ok: false,
        reason: "冷却泵 ID 或转速指令无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-cooling-pump-speed",
        actorAgentId: "captain",
        pumpId: pumpId as CoolantPumpId,
        commandedSpeedFraction,
      },
    };
  }

  if (toolCall.name === "set_electrical_load_enabled") {
    const loadId = argumentsObject.loadId;
    const enabled = argumentsObject.enabled;
    if (
      typeof loadId !== "string" ||
      !ELECTRICAL_LOAD_ID_SET.has(loadId) ||
      typeof enabled !== "boolean"
    ) {
      return {
        ok: false,
        reason: "配电负载 ID 或 enabled 参数无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-electrical-load-enabled",
        actorAgentId: "captain",
        loadId: loadId as ElectricalLoadId,
        enabled,
      },
    };
  }

  if (toolCall.name === "set_electrical_breaker") {
    const breakerId = argumentsObject.breakerId;
    const commandedClosed = argumentsObject.commandedClosed;
    if (
      typeof breakerId !== "string" ||
      !ELECTRICAL_BREAKER_ID_SET.has(breakerId) ||
      typeof commandedClosed !== "boolean"
    ) {
      return {
        ok: false,
        reason: "断路器 ID 或 commandedClosed 参数无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-electrical-breaker",
        actorAgentId: "captain",
        breakerId: breakerId as ElectricalBreakerId,
        commandedClosed,
      },
    };
  }

  if (toolCall.name === "set_battery_mode") {
    const batteryId = argumentsObject.batteryId;
    const mode = argumentsObject.mode;
    if (
      typeof batteryId !== "string" ||
      !ELECTRICAL_BATTERY_ID_SET.has(batteryId) ||
      typeof mode !== "string" ||
      !BATTERY_CONTROL_MODE_SET.has(mode)
    ) {
      return {
        ok: false,
        reason: "储能组 ID 或控制模式无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-battery-mode",
        actorAgentId: "captain",
        batteryId: batteryId as ElectricalBatteryId,
        mode: mode as BatteryControlMode,
      },
    };
  }

  if (toolCall.name === "set_habitat_ring_control") {
    const ringId = argumentsObject.ringId;
    const controlMode = argumentsObject.controlMode;
    const targetRelativeRpm = argumentsObject.targetRelativeRpm;
    if (
      typeof ringId !== "string" ||
      !ROTATION_RING_ID_SET.has(ringId) ||
      typeof controlMode !== "string" ||
      !RING_CONTROL_MODE_SET.has(controlMode) ||
      typeof targetRelativeRpm !== "number" ||
      !Number.isFinite(targetRelativeRpm) ||
      targetRelativeRpm < -12 ||
      targetRelativeRpm > 12
    ) {
      return {
        ok: false,
        reason: "居住环 ID、控制模式或相对转速目标超出设备边界",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-habitat-ring-control",
        actorAgentId: "captain",
        ringId: ringId as RotationRingId,
        controlMode: controlMode as RingControlMode,
        targetRelativeRpm,
      },
    };
  }

  if (toolCall.name === "revise_mission") {
    const disposition = argumentsObject.disposition;
    const destination = argumentsObject.destination;
    const objective = argumentsObject.objective;
    const route = argumentsObject.route;
    const totalDistanceLightYears = argumentsObject.totalDistanceLightYears;
    const totalLegs = argumentsObject.totalLegs;
    if (
      typeof disposition !== "string" ||
      !["continue", "return", "divert", "abandon"].includes(disposition) ||
      typeof destination !== "string" ||
      typeof objective !== "string" ||
      !Array.isArray(route) ||
      !route.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).label === "string" &&
          typeof (item as Record<string, unknown>).distanceFromPreviousLightYears === "number",
      ) ||
      typeof totalDistanceLightYears !== "number" ||
      !Number.isFinite(totalDistanceLightYears) ||
      typeof totalLegs !== "number" ||
      !Number.isSafeInteger(totalLegs)
    ) {
      return { ok: false, reason: "任务处置、目的地、目标或航路参数无效" };
    }
    return {
      ok: true,
      command: {
        kind: "revise-mission",
        actorAgentId: "captain",
        disposition: disposition as "continue" | "return" | "divert" | "abandon",
        destination,
        objective,
        route: route as Array<{ id: string; label: string; distanceFromPreviousLightYears: number }>,
        totalDistanceLightYears,
        totalLegs,
      },
    };
  }

  if (toolCall.name === "manage_department_order") {
    const action = argumentsObject.action;
    if (typeof action !== "string" || !["create", "change", "cancel", "request-report"].includes(action)) {
      return { ok: false, reason: "部门命令 action 无效" };
    }
    const departmentId = argumentsObject.departmentId;
    const priority = argumentsObject.priority;
    if (departmentId !== undefined && (typeof departmentId !== "string" || !(SHIP_DEPARTMENT_IDS as readonly string[]).includes(departmentId))) {
      return { ok: false, reason: "departmentId 无效" };
    }
    if (priority !== undefined && (typeof priority !== "string" || !(ORDER_PRIORITIES as readonly string[]).includes(priority))) {
      return { ok: false, reason: "priority 无效" };
    }
    return {
      ok: true,
      command: {
        kind: "manage-department-order",
        actorAgentId: "captain",
        action: action as "create" | "change" | "cancel" | "request-report",
        ...(typeof argumentsObject.orderId === "string" ? { orderId: argumentsObject.orderId } : {}),
        ...(typeof departmentId === "string" ? { departmentId: departmentId as (typeof SHIP_DEPARTMENT_IDS)[number] } : {}),
        ...(typeof argumentsObject.title === "string" ? { title: argumentsObject.title } : {}),
        ...(typeof argumentsObject.instruction === "string" ? { instruction: argumentsObject.instruction } : {}),
        ...(typeof priority === "string" ? { priority: priority as (typeof ORDER_PRIORITIES)[number] } : {}),
        ...(typeof argumentsObject.deadlineSeconds === "number" ? { deadlineSeconds: argumentsObject.deadlineSeconds } : {}),
        ...(typeof argumentsObject.estimatedWorkSeconds === "number" ? { estimatedWorkSeconds: argumentsObject.estimatedWorkSeconds } : {}),
        ...(typeof argumentsObject.reportingIntervalSeconds === "number" ? { reportingIntervalSeconds: argumentsObject.reportingIntervalSeconds } : {}),
        ...(typeof argumentsObject.reason === "string" ? { reason: argumentsObject.reason } : {}),
      },
    };
  }

  if (toolCall.name === "publish_communication") {
    const communicationKind = argumentsObject.communicationKind;
    if (
      typeof communicationKind !== "string" ||
      !["announcement", "policy-explanation", "grievance-response", "external-message"].includes(communicationKind) ||
      typeof argumentsObject.audienceOrTarget !== "string" ||
      typeof argumentsObject.subject !== "string" ||
      typeof argumentsObject.message !== "string"
    ) return { ok: false, reason: "通信类型、对象、主题或正文无效" };
    return { ok: true, command: {
      kind: "publish-communication", actorAgentId: "captain",
      communicationKind: communicationKind as "announcement" | "policy-explanation" | "grievance-response" | "external-message",
      audienceOrTarget: argumentsObject.audienceOrTarget,
      subject: argumentsObject.subject,
      message: argumentsObject.message,
      ...(typeof argumentsObject.deliveryDelaySeconds === "number" ? { deliveryDelaySeconds: argumentsObject.deliveryDelaySeconds } : {}),
      ...(typeof argumentsObject.relatedGrievanceId === "string" ? { relatedGrievanceId: argumentsObject.relatedGrievanceId } : {}),
    } };
  }

  if (toolCall.name === "manage_crew_assignment") {
    const departmentId = argumentsObject.departmentId;
    const shiftId = argumentsObject.shiftId;
    if (
      typeof argumentsObject.personId !== "string" ||
      typeof departmentId !== "string" || !(SHIP_DEPARTMENT_IDS as readonly string[]).includes(departmentId) ||
      typeof argumentsObject.role !== "string" ||
      typeof shiftId !== "string" || !(DUTY_SHIFT_IDS as readonly string[]).includes(shiftId) ||
      typeof argumentsObject.departmentHead !== "boolean" ||
      !(argumentsObject.dutyZoneId === null || (typeof argumentsObject.dutyZoneId === "string" && /^[AB]-(0[1-9]|1[0-9]|2[0-4])$/.test(argumentsObject.dutyZoneId)))
    ) return { ok: false, reason: "人员、部门、岗位、班次或值班区无效" };
    return { ok: true, command: {
      kind: "manage-crew-assignment", actorAgentId: "captain",
      personId: argumentsObject.personId,
      departmentId: departmentId as (typeof SHIP_DEPARTMENT_IDS)[number],
      role: argumentsObject.role,
      shiftId: shiftId as (typeof DUTY_SHIFT_IDS)[number],
      dutyZoneId: argumentsObject.dutyZoneId as ZoneId | null,
      departmentHead: argumentsObject.departmentHead,
    } };
  }

  if (toolCall.name === "manage_person") {
    const action = argumentsObject.action;
    const triageLevel = argumentsObject.triageLevel;
    const priority = argumentsObject.priority;
    if (
      typeof action !== "string" || !["wake", "hibernate", "triage", "treat", "transfer", "evacuate"].includes(action) ||
      typeof argumentsObject.personId !== "string" ||
      (argumentsObject.zoneId !== undefined && (typeof argumentsObject.zoneId !== "string" || !/^[AB]-(0[1-9]|1[0-9]|2[0-4])$/.test(argumentsObject.zoneId))) ||
      (triageLevel !== undefined && (typeof triageLevel !== "string" || !["none", "routine", "urgent", "critical", "expectant"].includes(triageLevel))) ||
      (priority !== undefined && (typeof priority !== "string" || !(ORDER_PRIORITIES as readonly string[]).includes(priority)))
    ) return { ok: false, reason: "个人处置参数无效" };
    return { ok: true, command: {
      kind: "manage-person", actorAgentId: "captain",
      action: action as "wake" | "hibernate" | "triage" | "treat" | "transfer" | "evacuate",
      personId: argumentsObject.personId,
      ...(typeof argumentsObject.zoneId === "string" ? { zoneId: argumentsObject.zoneId as ZoneId } : {}),
      ...(typeof triageLevel === "string" ? { triageLevel: triageLevel as "none" | "routine" | "urgent" | "critical" | "expectant" } : {}),
      ...(typeof argumentsObject.treatmentPlan === "string" ? { treatmentPlan: argumentsObject.treatmentPlan } : {}),
      ...(typeof priority === "string" ? { priority: priority as (typeof ORDER_PRIORITIES)[number] } : {}),
    } };
  }

  if (toolCall.name === "manage_security") {
    const action = argumentsObject.action;
    const teamId = argumentsObject.teamId;
    const accessMode = argumentsObject.accessMode;
    if (
      typeof action !== "string" || !["deploy", "set-access", "detain", "release", "investigate", "protect"].includes(action) ||
      typeof argumentsObject.reason !== "string" ||
      (teamId !== undefined && (typeof teamId !== "string" || !(SECURITY_TEAM_IDS as readonly string[]).includes(teamId))) ||
      (accessMode !== undefined && (typeof accessMode !== "string" || !["open", "restricted", "sealed"].includes(accessMode)))
    ) return { ok: false, reason: "安保行动参数无效" };
    return { ok: true, command: {
      kind: "manage-security", actorAgentId: "captain",
      action: action as "deploy" | "set-access" | "detain" | "release" | "investigate" | "protect",
      reason: argumentsObject.reason,
      ...(typeof teamId === "string" ? { teamId: teamId as (typeof SECURITY_TEAM_IDS)[number] } : {}),
      ...(typeof argumentsObject.zoneId === "string" ? { zoneId: argumentsObject.zoneId as ZoneId } : {}),
      ...(typeof argumentsObject.connectionId === "string" ? { connectionId: argumentsObject.connectionId } : {}),
      ...(typeof accessMode === "string" ? { accessMode: accessMode as "open" | "restricted" | "sealed" } : {}),
      ...(typeof argumentsObject.personId === "string" ? { personId: argumentsObject.personId } : {}),
      ...(typeof argumentsObject.caseId === "string" ? { caseId: argumentsObject.caseId } : {}),
    } };
  }

  if (toolCall.name === "manage_logistics") {
    const action = argumentsObject.action;
    if (typeof action !== "string" || !["set-ration", "configure-agriculture", "move-cargo", "allocate-cabin", "manufacture-part", "approve-substitution"].includes(action)) {
      return { ok: false, reason: "后勤 action 无效" };
    }
    return { ok: true, command: {
      kind: "manage-logistics", actorAgentId: "captain",
      action: action as "set-ration" | "configure-agriculture" | "move-cargo" | "allocate-cabin" | "manufacture-part" | "approve-substitution",
      ...(typeof argumentsObject.rationKgPerPersonDay === "number" ? { rationKgPerPersonDay: argumentsObject.rationKgPerPersonDay } : {}),
      ...((AGRICULTURE_BAY_IDS as readonly unknown[]).includes(argumentsObject.agricultureBayId) ? { agricultureBayId: argumentsObject.agricultureBayId as (typeof AGRICULTURE_BAY_IDS)[number] } : {}),
      ...(typeof argumentsObject.crop === "string" ? { crop: argumentsObject.crop } : {}),
      ...(typeof argumentsObject.intensityFraction === "number" ? { intensityFraction: argumentsObject.intensityFraction } : {}),
      ...(typeof argumentsObject.cargoId === "string" ? { cargoId: argumentsObject.cargoId } : {}),
      ...(typeof argumentsObject.quantity === "number" ? { quantity: argumentsObject.quantity } : {}),
      ...(typeof argumentsObject.destinationZoneId === "string" ? { destinationZoneId: argumentsObject.destinationZoneId as ZoneId } : {}),
      ...(typeof argumentsObject.personId === "string" ? { personId: argumentsObject.personId } : {}),
      ...(typeof argumentsObject.cabinId === "string" ? { cabinId: argumentsObject.cabinId } : {}),
      ...((FABRICATOR_IDS as readonly unknown[]).includes(argumentsObject.fabricatorId) ? { fabricatorId: argumentsObject.fabricatorId as (typeof FABRICATOR_IDS)[number] } : {}),
      ...((MAINTENANCE_PART_IDS as readonly unknown[]).includes(argumentsObject.partId) ? { partId: argumentsObject.partId as (typeof MAINTENANCE_PART_IDS)[number] } : {}),
      ...(typeof argumentsObject.assetId === "string" && MAINTENANCE_ASSET_ID_SET.has(argumentsObject.assetId) ? { assetId: argumentsObject.assetId as MaintenanceAssetId } : {}),
      ...(typeof argumentsObject.deratingFraction === "number" ? { deratingFraction: argumentsObject.deratingFraction } : {}),
      ...(typeof argumentsObject.reason === "string" ? { reason: argumentsObject.reason } : {}),
    } };
  }

  if (toolCall.name === "set_compartment_connection") {
    if (typeof argumentsObject.connectionId !== "string" || typeof argumentsObject.commandedOpenFraction !== "number") return { ok: false, reason: "舱门连接或开度无效" };
    return { ok: true, command: { kind: "set-compartment-connection", actorAgentId: "captain", connectionId: argumentsObject.connectionId, commandedOpenFraction: argumentsObject.commandedOpenFraction } };
  }
  if (toolCall.name === "schedule_hull_repair") {
    const priority = argumentsObject.priority;
    if (typeof argumentsObject.breachId !== "string" || typeof priority !== "string" || !(ORDER_PRIORITIES as readonly string[]).includes(priority)) return { ok: false, reason: "破口 ID 或优先级无效" };
    return { ok: true, command: { kind: "schedule-hull-repair", actorAgentId: "captain", breachId: argumentsObject.breachId, priority: priority as (typeof ORDER_PRIORITIES)[number] } };
  }
  if (toolCall.name === "set_thermal_control") {
    const targetType = argumentsObject.targetType;
    if (typeof targetType !== "string" || !["radiator", "heat-exchanger"].includes(targetType) || typeof argumentsObject.controlFraction !== "number") return { ok: false, reason: "热控对象或控制比例无效" };
    return { ok: true, command: {
      kind: "set-thermal-control", actorAgentId: "captain", targetType: targetType as "radiator" | "heat-exchanger", controlFraction: argumentsObject.controlFraction,
      ...((RADIATOR_IDS as readonly unknown[]).includes(argumentsObject.radiatorId) ? { radiatorId: argumentsObject.radiatorId as (typeof RADIATOR_IDS)[number] } : {}),
      ...((HEAT_EXCHANGER_IDS as readonly unknown[]).includes(argumentsObject.heatExchangerId) ? { heatExchangerId: argumentsObject.heatExchangerId as (typeof HEAT_EXCHANGER_IDS)[number] } : {}),
    } };
  }
  if (toolCall.name === "set_atmosphere_supply") {
    const gas = argumentsObject.gas;
    const operation = argumentsObject.operation;
    if (typeof argumentsObject.zoneId !== "string" || typeof gas !== "string" || !["oxygen", "nitrogen", "carbonDioxide", "waterVapor"].includes(gas) || typeof operation !== "string" || !["add", "remove"].includes(operation) || typeof argumentsObject.massKg !== "number") return { ok: false, reason: "气体补充参数无效" };
    return { ok: true, command: { kind: "set-atmosphere-supply", actorAgentId: "captain", zoneId: argumentsObject.zoneId as ZoneId, gas: gas as "oxygen" | "nitrogen" | "carbonDioxide" | "waterVapor", operation: operation as "add" | "remove", massKg: argumentsObject.massKg } };
  }
  if (toolCall.name === "set_oxygen_production") {
    const generatorId = argumentsObject.generatorId;
    const targetProductionKgPerHour =
      argumentsObject.targetProductionKgPerHour;
    if (
      typeof generatorId !== "string" ||
      !(OXYGEN_GENERATOR_IDS as readonly string[]).includes(generatorId) ||
      typeof argumentsObject.enabled !== "boolean" ||
      typeof targetProductionKgPerHour !== "number" ||
      !Number.isFinite(targetProductionKgPerHour) ||
      targetProductionKgPerHour < 0 ||
      targetProductionKgPerHour > 8
    ) {
      return { ok: false, reason: "制氧机、开关或目标产氧率无效" };
    }
    return {
      ok: true,
      command: {
        kind: "set-oxygen-production",
        actorAgentId: "captain",
        generatorId: generatorId as (typeof OXYGEN_GENERATOR_IDS)[number],
        enabled: argumentsObject.enabled,
        targetProductionKgPerHour,
      },
    };
  }
  if (toolCall.name === "distribute_water") {
    const action = argumentsObject.action;
    if (typeof action !== "string" || !["set-zone-allocation", "transfer-between-rings"].includes(action)) return { ok: false, reason: "水分配 action 无效" };
    return { ok: true, command: {
      kind: "distribute-water", actorAgentId: "captain", action: action as "set-zone-allocation" | "transfer-between-rings",
      ...(typeof argumentsObject.zoneId === "string" ? { zoneId: argumentsObject.zoneId as ZoneId } : {}),
      ...(typeof argumentsObject.kgPerAwakePersonDay === "number" ? { kgPerAwakePersonDay: argumentsObject.kgPerAwakePersonDay } : {}),
      ...(argumentsObject.fromRing === "a" || argumentsObject.fromRing === "b" ? { fromRing: argumentsObject.fromRing } : {}),
      ...(argumentsObject.toRing === "a" || argumentsObject.toRing === "b" ? { toRing: argumentsObject.toRing } : {}),
      ...(typeof argumentsObject.massKg === "number" ? { massKg: argumentsObject.massKg } : {}),
    } };
  }
  if (toolCall.name === "reset_protection") {
    const targetType = argumentsObject.targetType;
    if (targetType !== "reactor" && targetType !== "breaker") return { ok: false, reason: "保护复位对象无效" };
    return { ok: true, command: {
      kind: "reset-protection", actorAgentId: "captain", targetType,
      ...(typeof argumentsObject.reactorId === "string" && FUSION_REACTOR_ID_SET.has(argumentsObject.reactorId) ? { reactorId: argumentsObject.reactorId as FusionReactorId } : {}),
      ...(typeof argumentsObject.breakerId === "string" && ELECTRICAL_BREAKER_ID_SET.has(argumentsObject.breakerId) ? { breakerId: argumentsObject.breakerId as ElectricalBreakerId } : {}),
    } };
  }
  if (toolCall.name === "manage_maintenance_task") {
    const action = argumentsObject.action;
    const priority = argumentsObject.priority;
    if (typeof action !== "string" || !["cancel", "set-priority", "reassign"].includes(action) || typeof argumentsObject.taskId !== "string") return { ok: false, reason: "维修任务管理参数无效" };
    return { ok: true, command: {
      kind: "manage-maintenance-task", actorAgentId: "captain", action: action as "cancel" | "set-priority" | "reassign", taskId: argumentsObject.taskId,
      ...(typeof priority === "string" && (ORDER_PRIORITIES as readonly string[]).includes(priority) ? { priority: priority as (typeof ORDER_PRIORITIES)[number] } : {}),
      ...(typeof argumentsObject.crewId === "string" ? { crewId: argumentsObject.crewId } : {}),
      ...(typeof argumentsObject.robotId === "string" && (MAINTENANCE_ROBOT_IDS as readonly string[]).includes(argumentsObject.robotId) ? { robotId: argumentsObject.robotId } : {}),
      ...(typeof argumentsObject.reason === "string" ? { reason: argumentsObject.reason } : {}),
    } };
  }
  if (toolCall.name === "manage_sensor_operation") {
    const action = argumentsObject.action;
    const packageId = argumentsObject.packageId;
    const priority = argumentsObject.priority;
    if (typeof action !== "string" || !["set-frequency", "active-scan"].includes(action) || typeof packageId !== "string" || !(ACTIVE_SENSOR_PACKAGE_IDS as readonly string[]).includes(packageId)) return { ok: false, reason: "传感器操作参数无效" };
    return { ok: true, command: {
      kind: "manage-sensor-operation", actorAgentId: "captain", action: action as "set-frequency" | "active-scan", packageId: packageId as (typeof ACTIVE_SENSOR_PACKAGE_IDS)[number],
      ...(typeof argumentsObject.sampleIntervalSeconds === "number" ? { sampleIntervalSeconds: argumentsObject.sampleIntervalSeconds } : {}),
      ...(typeof argumentsObject.target === "string" ? { target: argumentsObject.target } : {}),
      ...(typeof argumentsObject.durationSeconds === "number" ? { durationSeconds: argumentsObject.durationSeconds } : {}),
      ...(typeof priority === "string" && (ORDER_PRIORITIES as readonly string[]).includes(priority) ? { priority: priority as (typeof ORDER_PRIORITIES)[number] } : {}),
    } };
  }
  if (toolCall.name === "manage_remote_asset") {
    const assetId = argumentsObject.assetId;
    const action = argumentsObject.action;
    if (typeof assetId !== "string" || !(REMOTE_ASSET_IDS as readonly string[]).includes(assetId) || typeof action !== "string" || !["deploy", "recover", "retask"].includes(action) || typeof argumentsObject.mission !== "string" || typeof argumentsObject.target !== "string") return { ok: false, reason: "远程资产任务参数无效" };
    return { ok: true, command: { kind: "manage-remote-asset", actorAgentId: "captain", assetId: assetId as (typeof REMOTE_ASSET_IDS)[number], action: action as "deploy" | "recover" | "retask", mission: argumentsObject.mission, target: argumentsObject.target } };
  }
  if (toolCall.name === "set_power_allocation") {
    if (typeof argumentsObject.loadId !== "string" || !ELECTRICAL_LOAD_ID_SET.has(argumentsObject.loadId) || typeof argumentsObject.maximumDemandFraction !== "number") return { ok: false, reason: "负载 ID 或功率上限无效" };
    return { ok: true, command: { kind: "set-power-allocation", actorAgentId: "captain", loadId: argumentsObject.loadId as ElectricalLoadId, maximumDemandFraction: argumentsObject.maximumDemandFraction } };
  }

  return {
    ok: false,
    reason: "工具不在舰长世界命令白名单中",
  };
}
