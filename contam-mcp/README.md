# CONTAM MCP Server

这个目录提供一个本地 `stdio` MCP server，用来把当前目录里的 CONTAM 命令行工具封装给 Codex Desktop / Codex Windows App 调用。

目前封装的是稳定、可自动化的 CLI 能力：

- `discover_contam_installation`
- `list_contam_case_files`
- `get_contam_program_help`
- `inspect_contam_project`
- `diagnose_contam_project`
- `update_contam_project_references`
- `start_contam_bridge_session`
- `get_contam_bridge_session`
- `list_contam_bridge_entities`
- `advance_contam_bridge_session`
- `close_contam_bridge_session`
- `run_contam_simulation`
- `upgrade_contam_project`
- `compare_contam_sim_results`
- `export_contam_sim_text`

## 设计取舍

这个版本优先封装 `ContamX`、`prjup`、`simcomp`、`simread`，而不是去自动点 `contamw3.exe` 的 GUI。

原因很直接：

- GUI 自动化很脆弱。
- `contamx3.exe` 和相关工具已经有明确的命令行入口。
- Codex 通过 MCP 调这些命令，比操作窗口更稳定、更容易复现。

## 安装

在这个目录里执行：

```powershell
npm install
```

## 启动测试

```powershell
node .\src\server.js
```

如果进程正常启动，它会进入 MCP 的 `stdio` 等待状态，不会打印交互菜单。

## 回归测试

已经内置一个基于 NIST 官方 `cottage-dcv.prj` 的真实案例回归脚本：

```powershell
npm run regression:cottage
```

还提供一个更大的 `MediumOffice.prj` 真实案例回归：

```powershell
npm run regression:medium-office
```

如果你想把两套官方回归一起跑：

```powershell
npm run regression:official
```

在公开推送前，建议先跑一遍仓库隐私检查：

```powershell
npm run privacy:check
```

它会扫描所有已跟踪文件，检查是否误提交了本机家目录、桌面目录或其他个人文件系统路径。GitHub Actions 也会自动执行这一步。

仓库根目录还带了一个 Windows GitHub Actions workflow：

- `.github/workflows/contam-mcp-regression.yml`

它会在 CI 里自动：

- 校验 CONTAM 可执行文件是否存在
- 安装 `contam-mcp` 依赖
- 从 NIST 下载 `cottage-dcv` 和 `MediumOffice` 官方案例
- 运行 `npm run regression:official`
- 上传 `tmp/ci-artifacts`，包含每个案例的日志和 JSON 摘要

如果你按仓库默认结构运行，官方回归会使用这些相对路径：

- `tmp/nist-cases/cottage/cottage-dcv.prj`
- `tmp/nist-cases/medium-office/MediumOffice.prj`

它会验证这些链路：

- bridge 会话能正常启动
- `junctions` 和 `ambientTargets` 元数据非空
- `namedJunctionTemperatureAdjustments` 可作用在真实 duct terminal / junction 上
- `namedAmbientPressureAdjustment` 可作用在真实 ambient terminal / envelope target 上
- `namedAmbientConcentrationAdjustments` 可作用在真实 ambient target + contaminant 组合上
- 推进后能收到 `PATH_FLOW_UPDATE` / `TERM_FLOW_UPDATE`

`MediumOffice` 回归额外会覆盖：

- 多个 input / output control node
- 多个 AHS 名称解析
- 更大的多区、多污染物模型

## 在 Codex Desktop 里接入

把下面这段加到你的 Codex 配置文件 `~/.codex/config.toml`：

```toml
[mcp_servers.contam]
command = "node"
args = ["<仓库绝对路径>\\contam-mcp\\src\\server.js"]
tool_timeout_sec = 300
```

然后重启 Codex Desktop。

因为这个 server 默认会在以下位置找 CONTAM 可执行文件，所以你现在这个目录结构不用额外配环境变量：

- `CONTAM_HOME`
- server 所在目录的上一级
- 当前工作目录

如果你以后把 MCP server 挪到别处，可以再设置这些环境变量之一：

- `CONTAM_HOME`
- `CONTAMX_PATH`
- `CONTAMW_PATH`
- `PRJUP_PATH`
- `SIMREAD_PATH`
- `SIMCOMP_PATH`

## 工具说明

### `discover_contam_installation`

确认 MCP server 当前能找到哪些 CONTAM 可执行文件，以及 `contamx3.exe` / `prjup.exe` 的版本号。

### `list_contam_case_files`

扫描目录树，列出 `.prj`、`.sim`、`.wth`、`.ctm` 等常见 CONTAM 文件。

### `get_contam_program_help`

读取某个 CONTAM CLI 程序的内置帮助文本，适合先让模型理解官方参数说明。

### `inspect_contam_project`

解析 `.prj` 的基础结构，返回：

- 格式头
- 标题
- 日期范围
- 关键 section 数量
- 引用的 weather / contaminant / WPC / EWC 等文件

### `diagnose_contam_project`

当项目跑不起来时，先用它检查：

- `.prj` 里实际配置了哪些依赖文件
- 这些文件在工作目录或项目目录里是否存在
- 如果不存在，项目目录附近有没有同名候选文件
- 可直接写回 `.prj` 的建议相对路径

### `update_contam_project_references`

直接修改 `.prj` 里这些引用：

- `weatherFile`
- `contaminantFile`
- `continuousValuesFile`
- `discreteValuesFile`
- `wpcFile`
- `ewcFile`

默认会在原文件旁边生成一个 `.mcp.bak` 备份。

### `run_contam_simulation`

运行 `contamx3.exe`。支持：

- 普通运行
- `-t` 输入校验
- 自定义 `workingDirectory`
- bridge address
- bridge wind
- bridge volume flow

工具会返回：

- 实际执行参数
- 退出码
- stdout / stderr
- 项目目录里的文件变化
- 与该项目同名的产物文件列表

### `start_contam_bridge_session`

启动一个持久的 ContamX bridge-mode 会话。会返回：

- `sessionId`
- 初始 `readyTimeSeconds`
- 项目元数据
- 初始握手阶段收到的消息类型

### `get_contam_bridge_session`

读取某个活动 bridge 会话的当前状态，包括：

- 项目路径
- 当前 ready 时间
- zone / path / AHS 等元数据
- `ambientTargets` 顺序
- 上一次 advance 的结果

### `list_contam_bridge_entities`

返回 bridge 会话里一份更短、更适合模型消费的实体清单。可列出：

- `zones`
- `paths`
- `junctions`
- `elements`
- `inputControlNodes`
- `outputControlNodes`
- `ahsSystems`
- `ambientTargets`

其中 `ambientTargets` 现在会同时给出：

- `label`: 可读标签
- `selectorLabel`: 带 ambient index 的唯一选择器，适合直接回填给 MCP

`paths` 也会带：

- `label`: 可读标签，可能重复
- `selectorLabel`: 带 path id 和 element name 的唯一选择器，适合解决 `Outdoor -> attic` 这种多条路径歧义

### `advance_contam_bridge_session`

对 bridge 会话做两类事：

- 先发控制节点或天气修正
- 再把 ContamX 推进到指定仿真时刻，并请求 update 消息

当前已支持这些调整消息：

- `controlNodeAdjustments`
- `namedControlNodeAdjustments`
- `zoneConcentrationAdjustments`
- `namedZoneConcentrationAdjustments`
- `zoneTemperatureAdjustments`
- `namedZoneTemperatureAdjustments`
- `junctionTemperatureAdjustments`
- `namedJunctionTemperatureAdjustments`
- `zoneHumidityRatioAdjustments`
- `namedZoneHumidityRatioAdjustments`
- `elementAdjustments`
- `namedElementAdjustments`
- `weatherAdjustment`
- `namedAmbientPressureAdjustment`
- `namedAmbientConcentrationAdjustments`
- `wpcAdjustment`
- `ahspFlowAdjustments`
- `ahsPoaAdjustments`
- `namedAhsPoaAdjustments`

其中这些名字解析已经可用：

- zone: 通过 `zoneName`
- junction: 通过 bridge 生成的 `Junction 1` / `Terminal 2` 这类标签
- input control node: 通过 `controlNodeName`
- airflow element: 通过 `elementName`
- AHS: 通过 `ahsName`
- path: 通过 `fromZoneName` + `toZoneName` 选择
- path: 也可以直接用 `pathSelectorLabel`

名字解析规则现在是：

- 先做规范化后的精确匹配
- 再尝试唯一的子串匹配
- 如果仍有多个候选，就直接报歧义并列出匹配项

对 path 选择器，`fromZoneName` / `toZoneName` 还支持这些室外别名：

- `Outdoor`
- `outside`
- `ambient`
- `室外`

对 `ambientTargets`，推荐优先使用 `selectorLabel`，因为像 `Outdoor -> Attic` 这种标签可能会重复；`Ambient 1: Outdoor -> Attic` 这种选择器才是唯一的。

对 ambient concentration，当前高层接口按“一条消息对应一个 contaminant”来组织。也就是说，如果你要给多个污染物发不同的室外边界浓度，建议传 `namedAmbientConcentrationAdjustments` 数组，每个对象指定一个 `agentName` 或 `agentId`。

也就是说，现在可以直接用类似这些输入：

- `namedZoneTemperatureAdjustments: { zoneNames: ["Kitchen"], values: [295.15] }`
- `namedJunctionTemperatureAdjustments: { junctionNames: ["Terminal 2"], values: [294.15] }`
- `namedAmbientPressureAdjustment: { ambientTargetNames: ["Ambient 9: Outdoor -> Kitchen"], values: [12.0], fillValue: 0 }`
- `namedAmbientConcentrationAdjustments: [{ agentName: "CO2", ambientTargetNames: ["Ambient 70: terminal:1"], values: [0.0008], fillValue: 0.0004 }]`
- `namedElementAdjustments: [{ pathSelectorLabel: "Path 21: Outdoor -> Kitchen [WallExt]", elementIndex: 5 }]`
- `namedElementAdjustments: [{ fromZoneName: "LivingDining", toZoneName: "Kitchen", elementName: "WallInt" }]`
- `namedAhsPoaAdjustments: { names: ["main"], values: [0.25] }`

当前支持请求这些更新：

- concentration updates
- path flow updates
- AHSP flow updates
- duct flow updates
- leak flow updates
- output control node updates

### `close_contam_bridge_session`

关闭 bridge 会话，释放 ContamX 进程和本地 socket。

### `upgrade_contam_project`

运行 `prjup.exe` 升级旧版 `.prj`。

### `compare_contam_sim_results`

运行 `simcomp.exe` 比较两个 `.sim` 文件。

### `export_contam_sim_text`

运行 `simread.exe`，把 `.sim` 导出为文本结果。

注意：`simread` 原生是交互式程序，所以 MCP 调用时必须提供：

- `responsesText`
- 或 `responsesFilePath`

也就是说，你要先准备好一段响应脚本，等价于：

```powershell
simread mycase.sim < responses.txt
```

## 当前限制

- 还没有做 `contamw3.exe` GUI 建模自动化。
- `simread` 的“响应脚本”格式依然依赖 CONTAM 自身的交互提示。
- bridge mode 仍未覆盖全部细分耦合消息；目前已支持 `ADJ_JCT_TEMP`，但 junction 本身没有来自 ContamW 的原生名字，所以名称控制依赖 `Junction N` / `Terminal N` 这种生成标签。
- bridge 元数据目前更偏工程可用，不是完整逐字段镜像官方协议。

## 后续建议

如果你想把这个 server 继续做强，下一步最值得补的是：

1. bridge mode 下更多修改消息
2. 常见 `simread` 导出模板
3. 更细粒度的项目文件编辑工具
4. 项目打包/搬运工具
