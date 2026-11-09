# doc 文档目录与阅读顺序

本目录存放 DBCraft 的需求、设计、现状、验收与操作记录。先看本页，再按角色选文档，避免在
「PRD / 审计 / 状态 / 清单」之间来回找同一件事。

> 整理原则：**`doc/PRD.md` 是需求基线，保持原样，不在整理时改写**；其余文档只补充索引与状态，
> 不移动、不改名、不删除，避免破坏已有交叉引用。功能是否实现看 `FEATURE_MATRIX.md`；
> 还差什么、怎么修看 `UNFINISHED_ITEMS.md`。

---

## 1. 文档地图

| 文档 | 定位 | 更新方式 | 适合谁 |
|---|---|---|---|
| `PRD.md` | 需求基线（v0.20）：分层、v1.0 基线、模块细节、§9 v1.x、技术附录 | **只读**；需求变化需单独评审后改 PRD | 产品、研发、测试 |
| `REQUIREMENTS_AUDIT.md` | 需求分层与隐藏需求审计（v0.17 基线）：哪些是用户明确要的、哪些是文档长出来的、哪些建议删/降级 | 需求取舍变化时更新；代码级状态不再逐条追 | 产品、研发负责人 |
| `CONNECTION_TAB_MODEL.md` | 连接 / 服务器 / 标签 / 会话模型审计与 Q21～Q28 决策记录 | 模型决策变化时更新 | 研发 |
| `FEATURE_MATRIX.md` | **功能总表**：按模块列出需要做的功能，标 `✅/🟡/❌/⏸` | 功能完成或新增需求时更新 | 所有人 |
| `PROJECT_STATUS.md` | 实现现状、模块缺口、缺陷、测试与验收、DDL 方案、日志约定、里程碑 | 每次改动/验收后同步 | 研发、测试 |
| `UNFINISHED_ITEMS.md` | 未完成项与隐藏需求：H/K/R 分组、证据、影响、建议、验收点 | 完成一项改状态；新缺口随时补 | 研发、排期 |
| `UI_TODO.md` | UI 逐项调整清单与真机验收状态 | 每项 UI 调整后勾选；没真机点过不能标 `[x]` | UI、测试 |
| `TECH_DESIGN.md` | 技术设计：进程模型、IPC、驱动、存储、安全 | 架构变化时更新；可能滞后于代码 | 研发 |
| `WORKLOG.md` | 追加式操作日志：诉求、变更、文件、验证、遗留 | **只追加，不改历史** | 所有人 |

---

## 2. 权威边界（冲突时看这里）

| 问题 | 以谁为准 | 说明 |
|---|---|---|
| 产品要不要做、优先级是什么 | `PRD.md` §0.2 / §9 | 需求取舍要单独评审；本文档不替 PRD 做决定 |
| 这个功能现在有没有 | `FEATURE_MATRIX.md` + 代码 | 状态是代码快照；`✅` 不等于真机验收 |
| 还差什么、怎么修 | `UNFINISHED_ITEMS.md` | 含证据行号、影响、建议与验收点 |
| 做到什么程度、验收过没有 | `PROJECT_STATUS.md` + `UI_TODO.md` | 测试记录与真机验收分开看 |
| 连接/标签/会话怎么设计 | `CONNECTION_TAB_MODEL.md` + PRD §0.5 | v0.20 目标模型 |
| 技术怎么实现 | `TECH_DESIGN.md` + 源码 | 文档滞后时以源码/测试脚本为准 |
| 某次改了什么 | `WORKLOG.md` | 追加式记录，不改历史 |

---

## 3. 建议阅读顺序

### 新加入项目

1. `PRD.md` §0（分层与 v1.0 基线）→ §2（范围）→ §4（模块细节）
2. `FEATURE_MATRIX.md`（现在有什么、还缺什么）
3. `UNFINISHED_ITEMS.md`（下一步能做什么）
4. `PROJECT_STATUS.md` §1～§4（现状、缺陷、测试与验收）
5. `CONNECTION_TAB_MODEL.md`（标签/会话模型，避免改错）
6. `TECH_DESIGN.md` + 源码

### 产品 / 排期

`PRD.md` §0.2 / §9 → `FEATURE_MATRIX.md` 的 ❌/🟡 → `UNFINISHED_ITEMS.md` 建议顺序 → `PROJECT_STATUS.md` §4.7。

### 开发 / 修 bug

`UNFINISHED_ITEMS.md` 对应条目 → `FEATURE_MATRIX.md` 状态 → 源码证据 → `PROJECT_STATUS.md` 已知缺陷 → `UI_TODO.md` 验收。

### 测试 / 验收

`FEATURE_MATRIX.md` 的 `🟡/❌` → `PROJECT_STATUS.md` §4（自动化与手工清单）→ `UI_TODO.md` 勾选与真机记录。

---

## 4. 本次整理做了什么

- 新增 `FEATURE_MATRIX.md`：164 行功能清单，`✅ 81 / 🟡 23 / ❌ 52 / ⏸ 8`。
- 新增本页 `doc/README.md`：文档地图、权威边界、阅读顺序。
- `README.md`（根目录）文档索引加入本页与 `FEATURE_MATRIX.md`。
- `UNFINISHED_ITEMS.md` 顶部加入功能总表链接，避免两份清单各说各话。
- `WORKLOG.md` 追加 `W-20261109-26`。
- **没有移动、重命名或删除任何现有文档**；**`PRD.md` 未被修改**（整理前后 SHA256 一致：
  `13A50E21B49854A6BBCCAC781ABB561C94FE9B614F8570555B40E4D5CD7904DA`）。

后续如果要归档过期文档，建议先确认没有引用，再统一移到 `doc/archive/`；本次不做，避免断链。

---

## 5. 维护规则

1. **PRD 只读**：需要改需求时先评审，再改 PRD；不要在整理/实现时顺手改写。
2. **功能状态只维护一处**：`FEATURE_MATRIX.md` 负责「有没有」，`UNFINISHED_ITEMS.md` 负责「怎么补」，
   `PROJECT_STATUS.md` 负责「验收结论」。同一事实不要在三处写不同结论。
3. **完成一项**：改 `FEATURE_MATRIX.md` 状态 → 更新 `PROJECT_STATUS.md` 对应缺口 → 需要 UI 验收的勾 `UI_TODO.md`
   → 追加 `WORKLOG.md`。
4. **`✅` 的口径**：代码主路径可用；是否真机点过看 `UI_TODO.md`，是否有自动化看 `PROJECT_STATUS.md` §4。
5. **日志只追加**：`WORKLOG.md` 不改历史条目；编号按 `W-YYYYMMDD-NN` 递增。
