# RevoGrid Core Spike

用于验证 RevoGrid Core 是否满足 DBCraft 的表格需求。不是正式功能代码。

## 运行

```bash
cd spikes/revogrid
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 5273
```

自动化检查（需要本机 Edge；脚本里的 Edge 路径可按需修改）：

```bash
node scripts/smoke.mjs
node scripts/interactions.mjs
node scripts/filter-ui.mjs
```

## 验证规模

- 25,000 行 × 30 列
- 文本、数字、日期、布尔、枚举、NULL、大文本、中文
- 行/列虚拟滚动
- 区域选择 + TSV 复制
- 从 Excel/TSV 粘贴
- 自定义 React 编辑器
- 过滤面板
- 右键菜单（Spike 自研）

## 验证结果

| 项目 | 结果 | 说明 |
|---|---|---|
| 25,000 行渲染/滚动 | 通过 | 列/行虚拟化正常 |
| 区域选择 | 通过 | 拖拽/Shift 点击可用 |
| 复制 TSV | 通过 | 多选区域 `Ctrl+C` 触发 `clipboardrangecopy` |
| 粘贴区域 | 通过 | `Ctrl+V` 触发 `clipboardrangepaste`，数据写入成功 |
| 自定义枚举编辑器 | 通过 | React `<select>`，Enter 保存，Escape 取消 |
| 自定义布尔编辑器 | 通过 | React `<select>` |
| 自定义日期编辑器 | 通过 | `<input type="date">` |
| 大文本/中文编辑器 | 通过 | `<textarea>`，中文内容可保存并显示 |
| 过滤 UI | 通过 | 列头漏斗按钮可打开过滤面板 |
| 右键菜单 | 通过（需自研） | RevoGrid 不带业务右键菜单，需自行监听 `contextmenu` |
| 滚动到指定行 | 通过 | `scrollToRow` 正常 |
| 单单元格复制 | 需确认 | 单格 `Ctrl+C` 未触发 `clipboardrangecopy`，可能只走原生剪贴板；正式实现需验证/补事件 |
| IME 组合输入 | 未验证 | 中文文本写入通过，但输入法组合态需人工验证 |
| 无障碍 | 未验证 | 需 NVDA/键盘导航人工检查 |
| 多区域选择 | 不适用 | Core 只有单区域；多区域是 Pro，v1.0 单区域足够 |

## 关键发现

1. **`getSelectedRange().x` 不包含 pinned 列**  
   固定列（`colPinStart`）在独立维度中。映射列时必须按 `range.colType` 和列 pin 分组：
   - `colPinStart` → pinned start 列
   - `colPinEnd` → pinned end 列
   - `rgCol` → 非固定列

   Spike 里的右键菜单已按这个规则处理。

2. **右键菜单需要自研**  
   RevoGrid Core 没有业务右键菜单，但可以通过容器 `onContextMenu` + `getSelectedRange()` 实现；选中列映射要按上面的 pinned 规则处理。

3. **单格复制与区域复制行为不同**  
   多选区域 `Ctrl+C` 能触发 `clipboardrangecopy`；单格复制未触发该事件，正式实现需要确认是否依赖原生复制或补一个单格复制路径。

4. **过滤面板默认是 `None`**  
   需要用户选择 `Equal/Contains` 等操作符后才出现输入框。正式产品可考虑默认 `Contains` 或 `Equal`，减少一次点击。

5. **Core 的单区域选择够用**  
   数据库表格主要是“选中一块复制/导出”，不需要多区域；多区域是 Pro，v1.0 不采购。

## 结论

RevoGrid Core 通过 Spike，可以作为 DBCraft v1.0 的数据网格。

需要在正式实现中补：

- pinned 列感知的列映射；
- 自研右键菜单；
- 单格复制路径确认；
- 过滤默认操作符；
- IME 与无障碍人工验证。
