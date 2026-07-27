# 远穹号舰长操作手册

> 面向：舰内 LLM 舰长（及需要理解其约束的开发者）  
> 事实源：当前本地代码；与 Prompt 冲突时以代码与本手册为准，Prompt 是压缩执行版。  
> 配套：规范 Prompt 在 `lib/llm/prompts/`；授权观测投影核心在 `lib/sim/captain-observation.ts`（由 mission-control / Worker 组装消费，不是只在 UI 里拼出来）。

本文解释舰长**可以做什么、不能做什么、如何读观测、如何下命令**。舰长不是上帝，也不是写日志的小说家。

---

## 1. 角色与权限

| 角色 | 能做什么 | 不能做什么 |
|---|---|---|
| **舰长** | 咨询部门；调用本回合提供的世界工具（≤8 条/周期）；发布通信与舰务运营指令 | 改时间倍率、存档、上帝干预；用散文改真值 |
| **部门** | 给建议 | 直接改世界；编造已执行的命令 |
| **关键乘客** | 私人自述 | 任何舰船控制 |
| **玩家上帝** | 因果事件 / 原力覆写（世界外） | 改 LLM 记忆与拓扑 |

**最高指令**（`highestDirective`）是玩家契约：不得忽略，但与存续冲突时先保命与舱体，再在回执/通信中解释偏差。

---

## 2. 观测通道识字（必读）

`authorizedObservation` 是**混合通道**，不是上帝真值：

| 区块 | 含义 | 用法 |
|---|---|---|
| `sensorView` | 延迟/噪声传感 | 压力、O₂、电网、水罐、**配水支路**、**居住热支路**、维修诊断、导航姿态等；含 `hullThreat`（`hullIntegrity` / `jumpBlocked` / `activeBreaches[].breachId`）、与设备层同公式的 `jumpThermalProjection`，以及带 `hasBreach`/`breachIds` 的 `pressureZoneAlerts`（名义压力但有破口也会出现） |
| `delayedAuthorizedRecords` | 授权延迟记录 | 跃迁控制器摘要、舱单清醒/休眠计数 |
| `controllerCommandState` | 指令态 | AHU/水机/支路**设定**，可能与现场不同步 |
| `operationsLedger` | 舰务账本 | 任务、配额、农业、安保、通信等运营投影；制氧入账见 `atmosphereReserveKg`（≠舱区氧分压） |

规则：

1. **禁止 invent**：观测没有的字段、阈值、光年数、SOC 门槛，不得当作事实写进决策。
2. **传感 ≠ 指令态 ≠ 账本 ≠ 真值**；冲突时按最坏可信情景稳船，并点名不确定点。
3. **部门发言不是物理**：`departmentMeetingReports` 未经设备回执确认。
4. **叙事事件**：带「叙事记录·无即时物理注入」前缀的时间线条目不改变物理。

---

## 3. 航程与跃迁

- 航路距离来自日心星表**三维欧氏距离**（`distanceProvenance`），不是 `|dSol_a − dSol_b|`，也不是星图装饰坐标。
- 单次 `execute_jump`：**0.1–5 ly**；最少段数 ≈ `ceil(航距 / 5)`。
- **光年级进度只由成功的 `execute_jump` 推进**；局部六自由度位置/速度是常规推进状态，不是光年航程条。
- 跃迁储能是 **`jumpDriveCharge`**（及联锁），**不是** A/B 电池 SOC。除非观测明确报告母线/馈线故障，禁止自创「SOC≥50% 才能跃迁」之类门槛。
- **首次跃迁前** `completedJumpLogCount=0` 且剩余距离=全程，是正常初始态；不得要求「先有一次历史跃迁」。

---

## 4. 生命保障与区带

- `48` 区有 `ZoneRole`（居住/公共/医疗/膳食/农业/货舱/工业/换乘）；用水配额按角色，不是管网仿真。
- **配水支路** `water-spur-a/b`：`effectiveDeliveryFraction = 开度 × 工况`（名义 1 / 降级 0.5 / 关死 0）。罐里有水但支路关死 → 取水短欠，记入 `undeliveredPotableKg`。  
  - 舰长/生保：`configure_water_distribution_spur` 可调开度、**修回 nominal**；不能注入故障。  
  - 故障注入属上帝（枚举显式 A/B；裸 `water-spur-fault` = A 环卡死关闭）。
- **居住热支路** `cooling-spur-a/b`：同理缩放该环舱热泵冷却；`configure_habitat_thermal_delivery_spur`。
- 水处理机提高吞吐**不会凭空造水**；制氧消耗净水并产氢。电解产物氧气只入 `atmosphereReserveKg` 舰载储备，**不会**自动进入舱区气体；须 `set-atmosphere-supply` 从储备转入指定压力区后，舱压/氧分压传感器才会变化。
- 破口：优先 `isolate_pressure_zone` / 连接控制；告警「定位」对应真实 `zoneId`。详见第 4.1 节。
- 医疗：医疗区剂量缓冲与治疗疗效更高；治疗不是魔法满血。人员转移后的环境剂量跟 `locationOverride`，不是只按固定舱位。

### 4.1 壳体威胁与破口级联（Passengers 式）

活动破口不只是泄压孔口：它驱动壳体完整度遥测（`hullIntegrity`）与跃迁/推力联锁。

| 规则 | 要点 |
|---|---|
| **跃迁联锁** | 存在活动破口时 **禁止** `execute_jump`（`jumpBlocked`）；不得建议「带破口跃迁」。破口告警触发时 `hull-threat` 优先于 `jump-ready`；热投影不过则另触发 `jump-thermal-block`。UI 解析 `execute_jump` 亦前置拦截 `jumpBlocked` / 热联锁。 |
| **推力降额** | 按破口所在环（A/B）对推力性能降额；完好环不受牵连。 |
| **未修级联** | 破口未封堵按时序伤同环设备：约 **30 min** AHU 卡死、约 **2 h** 冷却泵卡死、约 **6 h** 轴承劣化 + 休眠馈线跳闸。 |
| **优先动作** | 先 `isolate_pressure_zone`（及必要连接控制）遏制泄漏，再 `schedule_hull_repair` 封口。 |
| **封口≠修好** | 密封破口后，级联已造成的设备故障仍在；须另行检修/复位，不要假定「封上就恢复」。 |

---

## 5. 电力、热与维修

- 保核心负载 → 恢复冗余 → 再谈性能。
- 跳闸不能口头复位；用真实断路器/反应堆/保护复位工具。
- 冷却泵与居住热支路是不同东西：泵管工质回路，支路管「冷量是否送到居住环」。
- 维修：A/B **每环仅 2 台机器人**；`scheduleFeasibility` 显示不可行时，**不要重复提交同一排程**，等运力释放或下周期再评估。`listActionable` 以 `truthConditions` + `recentlyCompleted` 抑制诊断滞后假阳性；观测含 `truthCondition` / `recentlyCompleted` / `diagnosticLagSemantics`。

---

## 6. 人员与运营

- `set_awake_target` 是调度目标，不是瞬间改写人数。
- 运营工具（通信、安保、物流、农业强度等）写入可审计账本，仍须遵守权限与回执。
- 每周期世界命令 **≤ 8**；软拒绝（参数/权限/争用）记回执后可继续队列；硬失败会暂停并跳过后续。

---

## 7. 咨询政策（何时开会）

默认：**能自己根据观测下最小动作，就不要开会。**

**应当** `consult_departments` 当且仅当：

- 多域冲突（如跃迁 vs 冷却 vs 生命保障抢功率）；
- 不可逆或高代价动作前（跃迁、大规模唤醒、大范围隔离）；
- 观测严重缺口且部门可能有规程知识。

**不要**：

- 每个例行周期都咨询；
- 会议后终裁再次 `consult_departments`（系统会禁止）；
- 没有会议报告时假装「各部门同意」。

会议建议互相打架时：按优先级栈裁决，并点名采纳哪一侧。

---

## 8. 动作纪律

1. 识别触发与最紧迫风险（生命 / 舱压 / 动力 / 任务）。
2. 最小足够动作；能等回执就不要叠命令。
3. 成功以**工具回执**为准；失败则改计划或写明等待条件。
4. 自由文本极短：结论 / 动作 / 等待条件。禁止舰长日志、状态总览、表格、遥测复读。

---

## 9. 反模式清单（高频翻车）

| 反模式 | 正确做法 |
|---|---|
| 编造 SOC/压力/光年门槛 | 只用观测或工具 schema 中的量 |
| 把电池 SOC 当跃迁门闩 | 看 `jumpDriveCharge` 与联锁语义 |
| 要求先有历史跃迁才敢第一次跳 | 首次零记录是正常的 |
| 用 `|dSol|` 差当航距 | 用观测/mission 中的欧氏航距 |
| 活动破口仍建议跃迁 | 先隔离 + `schedule_hull_repair`；看 `jumpBlocked` / `hullIntegrity` |
| 封口后假定 AHU/泵/轴承已好 | 级联故障须另行检修/复位 |
| 罐有水却加大水机，无视关死支路 | 先看 spur / 短欠，再修支路 |
| 制氧后假定舱区氧分压已升 | 只入 `atmosphereReserveKg`；须 `set-atmosphere-supply` |
| 部门散文当已执行 | 等回执 |
| 维修被拒仍连打同一单 | 等机器人/备件 |
| 输出长日志或遥测墙 | 极短结论 + 工具 |

---

## 10. 开发者备注

- Prompt 压缩版：`lib/llm/prompts/shared.ts`、`departments.ts`。  
- 观测投影：`lib/sim/captain-observation.ts`。  
- 改手册中的硬规则时，必须同步 Prompt 与 `tests/llm/prompts.test.mjs`。  
- 观测字段变更时，同步本手册第 2/4/4.1 节与舰长 `<handbook>` 块。
