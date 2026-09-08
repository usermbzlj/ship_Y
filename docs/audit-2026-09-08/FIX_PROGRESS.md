# 审计修复进度

基于 `docs/audit-2026-09-08/AUDIT.md`,以下是各缺陷的修复状态:

## ✅ 已修复 (PR #4)

### A02 · P1: 读档失败不再污染活动世界
**根因**: React在Worker确认前就修改了AI sidecar、worldEpoch、日程  
**修复**: 移动全部AI状态更新到Worker success路径;准备阶段只cancel决策+acquire barrier  
**提交**: `a0cb130`

### A03 · P1: 启动锁状态机
**根因**: `missionStartRequestedRef`被当成组件生命周期闩,读档不重置  
**修复**: 加载配置档时重置启动锁为`false`,允许再次签发  
**提交**: `a0cb130`

### A07 · P1: 人工干预保留长期记忆
**根因**: `submitIntervention`调用5类snapshot构造器清空长期状态  
**修复**: 移除journal/watch/standing/society/inbox重置,只清在途观测  
**提交**: `a0cb130`

### A09 · P1: 返航/改航距离从当前位置计算
**根因**: return用`currentMission.destination`作from,divert用`originalOrigin`  
**修复**: 从`journey.origin/destination + completedDistance`推断当前位置;允许零距离并立即arrived  
**提交**: `bc06571`

## ⏳ 待修复 (需单独PR)

### A01 · P1: 告警生命周期 - 区分实例vs历史
**复杂度**: 高 - 需重构detectAlerts为无状态+协调器对账  
**工作量**: 修改alert-banner.tsx + mission-control.tsx + use-local-save.ts  
**建议**: 单独PR,引入AlertCondition/AlertInstance分离

### A05 · P1: 双后端统一提交版本
**复杂度**: 中 - 需IDB+LS schema变更  
**工作量**: 修改local-save-idb.ts,增加commit.seq/id/writtenAtMs  
**建议**: 与存档格式升级一并处理

### A08 · P1: LLM服务状态五层分离
**复杂度**: 高 - 需重构gateway status机制  
**工作量**: lib/llm/index.ts + captain-decision-coordinator.ts + mission-control.tsx  
**建议**: 单独PR,分离configured/reachable/authenticated/retrying/failed

### A10 · P1: UI读活动journey而非表单
**复杂度**: 中 - 需投影层,依赖A09  
**工作量**: 新建projectActiveRoute + 修改VoyageView/StarMap  
**状态**: A09已修复模型层,UI投影待实现

### A04 · P2: 快捷键与按钮交互
**复杂度**: 低  
**工作量**: mission-control.tsx handleKeyDown + load-confirm-dialog focus trap  

### A06 · P2: LocalSave外层校验加强
**复杂度**: 低  
**工作量**: local-save-normalize.ts增加timeScale>=0、events非null校验

## 测试验证状态

- ✅ `npm run typecheck` - 通过
- ⏳ `node docs/audit-2026-09-08/reproduce.mjs` - 探针断言待更新
- ⏳ 新增行为测试 - A02/A03/A07/A09场景
- ⏳ `npm run test:fast` - 待运行
- ⏳ `npm run lint` - 待修复(28 errors baseline)

## 下一步

1. 更新reproduce.mjs探针:A02/A03/A07/A09的断言应期待健康行为
2. 补充行为测试覆盖修复场景
3. 单独PR处理A01(告警重构)
4. 单独PR处理A05+A08(存档+LLM状态机)
5. A10作为A09的配套UI修复
6. 更新PROJECT_STATUS.md同步当前状态
