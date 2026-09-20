# Redact 自动 Crossfade 设计

状态：对话中的架构和 B 方案已获批准；本文纳入最后一轮 UI 修订，等待书面设计评审。
基线：2026-09-18 拉取的 `origin/main`，提交 `0c28be9dabc8ca3c1573689b69a744ec251c1cc6`。
工作分支：`codex/redact-crossfade`。

## 1. 目标与范围

Redact 默认自动交叉淡化其左右保留内容，减少生硬接缝，同时保持原始音频、实体 clip、编辑时间线位置和 redact 范围不变。
用户已经确认 C1/C2 专指两侧参与混合的小区域，不是两个完整保留段，也不是新实体 clip。
C1/C2 始终等宽；各 30 ms 时同时混合为 30 ms，最终输出在删除 redact 的基础上再缩短 30 ms。

本阶段交付持久化、撤销、三态 UI、实时预听、导出及一致性验证。
继续使用现有 clip gain 和轨道音量，不新增通用 effects 编辑器。
手动 clip 重叠、利用被裁切素材余量的接缝过渡、normalization、EQ、压缩器和插件系统不在本阶段范围内。
这些能力通过明确的处理计划和执行边界扩展，不为尚未实现的能力创建空接口。

## 2. 已确认的视觉与交互

### 2.1 B 方案

- Redact 保持紫色斜纹与完整直角矩形边框，不使用圆角，也不去掉左右边框。
- C1/C2 在左右相邻保留区域显示更轻的细斜纹，纹理向外渐隐。
- 上下横线贯穿 C1、Redact、C2，中央与延伸部分使用一致的 1 CSS px 粗细及颜色，两端渐隐。
- 横线由单一绘制层负责，避免独立 border 叠加、重复描边、圆角空隙和像素取整差异。
- 波形和实体 clip 位置不变；覆盖层不修改源波形缓存。
- 未生效的过渡不显示可误认成有效音频范围的 C1/C2；编辑面板解释原因。
- 低缩放下按真实时长投影区域，不扩大可见音频范围来假装存在更长过渡。
- 颜色支持现有明暗主题，不能直接将 mock 的深色固定值复制到产品。

已批准视觉参考：独立 mock 的 B/texture 方案，位于 `/Users/boning/Workspaces/Podcut/output/redact-crossfade-mock/index.html`。
该 mock 的固定底部参数栏和重复菜单项已被本节后续要求替代，不作为实现依据。

### 2.2 三态

1. 未选中：只有直角 Redact 和两侧渐隐纹理，无淡化手柄、包络或参数面板。
2. 选中 Redact：按现有规则移动、缩放、删除 Redact，只显示 Redact 自身操作反馈，不进入 crossfade 编辑。
3. 编辑 Crossfade：显示左右等宽淡化手柄、包络和锚定浮动面板，禁用同次手势对 Redact 边界的修改。

使用现有 timeline selection 作为唯一选择来源，扩展其 redaction 分支的编辑模式；不再建立一份平行 selected 状态。
切换选中对象、删除对象、项目替换时退出 crossfade 编辑并清理浮动层。
保留 Option/Alt 透过 overlay 选择 clip 的现有语义。

### 2.3 单一右键入口和浮动面板

选择用户提供的第二种菜单方式：右键仅有一个“编辑交叉淡化…”入口，启用开关位于编辑面板内部。
无论当前是否开启，该入口都可用，用户可进入面板重新开启。
不同时放置“交叉淡化”开关菜单项和“编辑交叉淡化”菜单项。

浮动面板包含启用开关、时长、曲线、实际生效时长或未生效原因，以及“完成”。
关闭时保留已选时长和曲线，禁用数值控件但保持开关可用。
新增默认值为 30 ms、等功率；数值 UI 范围为 1–1000 ms，支持线性和等功率。
面板为非模态锚定 popover，不固定在音频面板下方。

定位规则：

- Portal 到不受音频面板 overflow 裁切的顶层浮动容器。
- 锚点为 Redact 与当前可见时间线的交集；优先上方居中，间隔 8 px。
- 上方容不下时翻转到下方；水平位置限制在视口左右各 8 px 内。
- 两侧都不够时使用视口内较大空间，限制面板高度并允许面板内容滚动；窄窗口内控件换行。
- 窗口缩放、面板重排、时间线滚动或缩放时重新测量，不保留过期屏幕坐标。
- 锚点完全离开可见时间线时关闭编辑层，已提交编辑保留，未完成拖拽取消。
- 右键菜单本身按指针位置显示并做同样的视口碰撞约束；键盘菜单使用 Redact 可见范围作为锚点。

键盘和历史规则：

- 菜单支持原生可访问菜单导航；Shift+F10 或菜单键可打开。
- 面板内输入、选择框和按钮的键盘操作不触发背景剪辑快捷键。
- 时长拖动实时预览，pointerup 作为一个历史动作；Escape 取消当前拖动并恢复开始值。
- 无活动拖动时，Escape 或“完成”关闭 crossfade 编辑并返回 Redact 选择态，不撤销已经提交的编辑。
- 点击外部关闭面板；切到其他对象时按该对象正常选择规则处理。
- 关闭后将焦点归还仍存在的 Redact；对象已删除时回到 Audio 面板。
- 同时拖动两个手柄没有独立时长：任何一侧改变都更新同一个 durationMs。

## 3. 基线事实与主要改动

当前 `ClipRedactions.ts` 已保存源时间覆盖层并临时推导保留段，无需切实体 clip。
`redactionTimeline.ts` 已实现多轨保留内容对全局删除的保护。
`playbackActions.ts` 的预听当前依赖时间回调触发 seek，必须替换为预先编排的音频计划，避免 UI 调度影响接缝。
`playbackPlan.ts` 每轨依次安排片段，不支持同一输出区间的两个贡献。
`AudioPlayerWorklet.ts` 当前在消费 PCM 时乘 clip gain；改为预合成 PCM 后，必须移除该重复乘法或将队列协议明确改为不携带 clip gain。
`renderer.ts` 使用 FFmpeg 单独计算输出安排，需要改为消费共享计划。
保留受控 PCM 缓存、48 kHz 处理率、每轨有界队列、mute/solo 及导出运行时解析规则。

## 4. 数据模型

### 4.1 持久化

正式类型由 Zod schema 推导，不独立维护重复 interface。
相比对话中的判别联合，启用开关独立于参数保存，以保证关闭再开启不丢失配置。

```ts
type CrossfadeCurve = 'linear' | 'equal-power'

type CrossfadeSettings = {
  enabled: boolean
  durationMs: number
  curve: CrossfadeCurve
}

type ClipRedaction = {
  id: string
  sourceStart: number
  sourceEnd: number
  crossfade?: CrossfadeSettings
}
```

`durationMs` 必须有限且在 1–1000 范围，源边界沿用现有校验。
所有新建 Redact 入口显式写入 `{ enabled: true, durationMs: 30, curve: 'equal-power' }`。
老工程字段缺失表示未启用，不在 schema default 中自动开启，从而改变旧工程声音。
编辑旧 Redact 时允许打开面板并显式开启。
复制和拆分 deep-copy 配置，保留独立 Redact 身份；trim 不删除隐藏配置。
撤销快照和保存序列化覆盖配置，模型包含新字段后不得被 IPC 或持久化过滤掉。
解析、保存和旧数据兼容性测试必须覆盖 strict schema；不声称旧版应用可读新版新增字段。

### 4.2 解析后过渡

运行时统一使用 48 kHz 整数帧，半开区间；源起止边界先各自量化，再计算差值。
用户期望时长保存在模型里；实际时长由解析器计算，不回写压缩后的设置。

```ts
type SourceSpan = {
  audioSourceId: AudioSourceId
  sourceStartFrame: number
  frameCount: number
}

type ResolvedCrossfade = {
  owner: { clipId: string; redactionIds: string[] }
  left: SourceSpan
  right: SourceSpan
  outputStartFrame: number
  frameCount: number
  curve: CrossfadeCurve
}

type CrossfadeResolution =
  | {
      status: 'active'
      transition: ResolvedCrossfade
      limitedBy?: 'short-content' | 'neighbor-transition'
    }
  | {
      status: 'inactive'
      reason: 'disabled' | 'no-join' | 'insufficient-content'
        | 'protected-track-content'
    }
```

左右 SourceSpan.frameCount 与 transition.frameCount 完全相等。
C1/C2 不越过保留区边界，不读取 Redact 内音频，不重复使用邻近过渡已经占用的采样。
运行时结果不保存进项目文件。

### 4.3 通用执行计划

```ts
type GainEnvelope =
  | { kind: 'constant' }
  | {
      kind: 'fade'
      direction: 'in' | 'out'
      curve: CrossfadeCurve
      startOutputFrame: number
      frameCount: number
    }

type AudioContribution = {
  clipId: string
  source: SourceSpan
  outputStartFrame: number
  gain: number
  envelope: GainEnvelope
}

type TrackRenderPlan = {
  trackId: string
  volume: number
  contributions: AudioContribution[]
}

type AudioRenderPlan = {
  sampleRate: 48000
  durationFrames: number
  tracks: TrackRenderPlan[]
  timeMap: TimelineTimeMap
}
```

普通音频贡献恒定 gain，crossfade 区间有两个音频贡献。
计划生成器同时返回供 UI 使用的 CrossfadeResolution 索引，由 clip/redaction 身份查找。
包络使用完整输出坐标，seek 或块边界不能重置包络起点。
曲线数值规范：N ≥ 2 帧时 u = clamp((outputFrame - startOutputFrame) / (N - 1), 0, 1)。
线性使用 fadeIn=u、fadeOut=1-u；等功率使用 sin(πu/2)、cos(πu/2)。
实际可用长度不足 2 帧时不生成过渡。
混音保持 float，不在轨道或贡献层静默归一化、限幅；现有 gain 与 track volume 只各应用一次。

## 5. 过渡解析与多轨保护

依次执行量化、有效 Redact 并集、全局跳过资格、候选接缝、可用宽度、保护检查、计划生成。
保留当前 muted/solo 与 retained-overlap 的资格规则，不以重构为由改变普通静音或自然空隙语义。

同 clip 重叠或相接的 Redact 先合并为有效组，不删除原对象身份。
组内有未配置或明确关闭 crossfade 的对象时，该组接缝关闭。
否则请求时长取最短值；曲线取按 sourceStart、sourceEnd、id 稳定排序的第一个对象。
面板说明当前配置影响合并接缝，以及被组内关闭配置阻止的情况。

首版仅处理同 clip 左右均有保留内容、且组的完整删除范围确实成为全局跳过区间的接缝。
组在 clip 开头或结尾、整段删除、只被部分全局删除时不生成双侧过渡。
不把不相邻的两个实际保留段强行连接。

候选按编辑时间、trackId、clipId 和组身份稳定排序。
先将请求宽度限制到相邻保留段长度；再按该顺序占用保留段头尾的可用采样，后续候选缩短以避免重复使用。
这是一项确定性先后规则，不声称两个相邻过渡必然获得相同比例的分配。
选择另一个 Redact 不改变结果。

对额外 overlap 收缩，检查完整 C1–Redact–C2 时间窗口。
如果另一 clip 按现有保留保护规则在此窗口有保留内容，则本过渡不生效，返回 protected-track-content；不能静默切掉其采样。
不跨轨联动创建一组新过渡，也不移动实体 clip 解决冲突。
未生效时仍按现有规则删除有资格跳过的 Redact 时间，额外 crossfade 收缩为零。

## 6. 时间坐标与 UI

Source time 是原文件时间，Timeline time 是未压缩编辑布局，Output time 是模式对应的执行时间。
现有 clip.outputStart 的含义仍为编辑布局位置；本阶段不修改持久化字段名称。
新增模块中使用 sourceFrame、timelineFrame、outputFrame，避免把坐标混用。

单接缝示例：原始总长 2 秒，Redact 240 ms，C1/C2 各 30 ms，最终输出为 1.730 秒，即 83,040 帧。
预听与导出使用同一个长度；clip 的编辑位置不变。

TimelineTimeMap 使用分段映射，而非对所有时间减一个常量。
普通段是一对一平移，删除段吸附到接缝入口，过渡输出段对应 C1/C2 两个 timeline 位置。
反向投影返回所有贡献位置及主要光标位置；前半段选择 C1，后半段选择 C2，光标不倒退。
从 C1 或 C2 点击 seek 可以落到同一混合输出位置，这是预期的多对一映射。
旧跳过区间恰好边界和输出终点必须使用一致的半开区间规则。

播放器增加显式 PlaybackMode：timeline 或 edited。
timeline 模式保留编辑长度，并沿用当前 Redact 区域静音语义，不合成跨删除区过渡。
edited 模式使用删除和 crossfade 后的计划。
导出固定使用 edited，不受交互 Preview 开关影响。
底层播放器的 seek、时钟和 duration 使用当前模式的 output 坐标；一个 renderer 播放适配层负责与编辑时间转换。
波形光标、转录导航、拆分位置继续使用 timeline 坐标；播放器接缝内部的双位置由投影策略选择。
模式切换先保存当前 timeline 定位，再在新计划映射回 output，避免因累计删除量突然定位到别的句子。

## 7. 执行端与资源边界

共享计划生成器是纯计算，不读取 Zustand、不调用 Node/FFmpeg、不持有 AudioNode。
实时端 TrackBlockRenderer 按计划读取有界 PCM，应用 gain 和包络，逐声道累加，再写入现有每轨队列。
轨道 GainNode 应用 track.volume；它不再乘一次 clip gain。
保留两秒目标缓冲、三秒硬上限、代次取消、underrun 诊断以及每轨对齐。
计划必须可索引到当前块涉及的贡献，不能在每个音频小块扫描整场所有贡献或读取整文件。
实时音频回调不做文件读取、计划构建或全量响度分析。

主进程从经过 schema 校验的项目快照独立构建同一纯计划，导出执行器翻译为 FFmpeg 滤镜。
使用 48 kHz 后的采样边界，按规范公式生成包络；不能假设 FFmpeg 同名曲线天然与实时公式逐采样相同。
以 float PCM 对照测试验证边界、声道和数值误差，再验证编码格式输出时长。
使用当前受管理运行时定位，不引入系统/Homebrew FFmpeg 回退。
导出错误不得被表现为部分成功，进度以输出帧长度为准。

## 8. 文件结构与命名

本次新增和实际修改的项目 TS/JS 模块采用 PascalCase 文件名，测试保留 .test.ts / .test.tsx 后缀。
涉及旧小写模块时先做独立机械重命名及全量引用更新，再做语义修改；不顺带重命名无关模块。
依赖这些路径的测试、构建、harness 和文档引用必须同时更新。
框架规定的 index.ts、配置文件等保留规定命名。

| 路径 | 职责 |
| --- | --- |
| src/shared/ProjectTypes.ts | 从 project.types.ts 机械重命名；项目 schema 增加 crossfade |
| src/shared/PlayerTypes.ts | 从 player.types.ts 重命名；显式播放模式和坐标契约 |
| src/shared/RedactionTimeline.ts | 从 redactionTimeline.ts 重命名；保留并复用删除资格 |
| src/shared/ClipRedactions.ts | 有效区间、原对象身份与保留段 |
| src/shared/audio/CrossfadeTypes.ts | 参数 schema 与解析结果类型 |
| src/shared/audio/AudioRenderPlan.ts | 运行时贡献与计划类型 |
| src/shared/audio/AudioRenderPlanBuilder.ts | 组合资格、过渡、时间映射与贡献 |
| src/shared/audio/RedactionTransitionResolver.ts | 接缝、保护规则、实际宽度 |
| src/shared/audio/TimelineTimeMap.ts | 分段坐标映射 |
| src/shared/audio/GainEnvelope.ts | 包络公式与区间采样 |
| src/renderer/src/audio/TrackBlockRenderer.ts | PCM 块合成 |
| src/renderer/src/audio/WorkletAudioPlayer.ts | 队列、时钟、计划切换和资源生命周期 |
| src/renderer/src/audio/AudioPlayerWorklet.ts | 消费已合成 PCM |
| src/renderer/src/audio/PlaybackTimelineAdapter.ts | UI 时间与播放器时间适配 |
| src/renderer/src/actions/PlaybackActions.ts | 从 playbackActions.ts 重命名；移除回调式跳过 |
| src/renderer/src/stores/TimelineStore.ts | 从 timeline.store.ts 重命名；选择和原子编辑历史 |
| src/renderer/src/components/Waveform/ClipRedactionOverlay.tsx | 原 Redact 选择、移动和边界缩放 |
| src/renderer/src/components/Waveform/RedactionCrossfadeOverlay.tsx | B 方案纹理、连续描边、包络与手柄 |
| src/renderer/src/components/Waveform/RedactionContextMenu.tsx | 单一 crossfade 编辑入口 |
| src/renderer/src/components/Waveform/CrossfadePopover.tsx | 启用开关、参数、实际结果和完成 |
| src/renderer/src/components/Waveform/UseAnchoredPopover.ts | 锚点测量、翻转、移位和失效关闭 |
| src/main/audio/Renderer.ts | 从 renderer.ts 重命名；编排导出参数 |
| src/main/audio/export/FfmpegPlanCompiler.ts | 将共享计划翻译为导出滤镜 |

旧 playbackPlan.ts 的独立时间编排被共享 builder 替代，删除前追踪所有调用和测试，不保留两套逻辑。
现有 App、stores、剪贴板和 UI 调用处按实际依赖修改；需要修改的旧小写 TS/JS 文件同样遵循独立机械重命名规则。
不修改个人 AGENTS.md 或技能文件。
架构、键盘和命名标准的必要说明随对应实现更新，但不提前把未实现能力写成现状。

## 9. 未来处理能力的边界

Gain 是音频贡献参数，Crossfade 是两个贡献的时间关系和包络；不放入同一个未经定义的 apply-effect 钩子。
未来 normalization 分析指定版本的最终混音计划，缓存键包含所有影响被分析声音的输入；分析输出再驱动节目输出处理。
EQ/压缩器扩展有序处理链和执行后端；状态、延迟、seek 预热由执行器负责。
本阶段不创建 normalization 空服务，也不承诺两套复杂 DSP 后端天然等价。

## 10. 验证与验收

### 数据与纯逻辑

- 新建入口默认开启，旧字段缺失保留原行为，禁用再开启保留参数。
- NaN、Infinity、非法曲线及超范围参数被 schema 拒绝。
- 重叠并集稳定、组内禁用有效、trim/split/copy/history 的身份与配置正确。
- 无左右素材、短保留段、相邻过渡、边界舍入及多轨保护有确定结果。
- 30 ms 等于 1,440 帧；示例长度为 83,040 帧。
- 时间映射覆盖删除内部、所有边界、过渡双来源和输出结尾。

### 音频

- 线性和等功率在整块、多个块、seek 到中间时得到相同采样。
- 左右声道均正确；clip gain 与 track volume 不重复应用。
- PCM 预听结果与 FFmpeg float 输出比较，长度完全一致，简单 gain/fade 样本绝对误差目标不超过 1e-5。
- 用实际语音、背景底噪和不同幅度的测试源听测；不以波形连续就声称所有素材无可闻接缝。
- edited/timeline 切换、播放中参数变化、快速 seek 和计划代次取消不使用旧音频块。
- 长节目与多 redact 仍遵守每轨缓冲上限。

### UI

- 验证 B 三态，未进入编辑不显示包络和手柄，Redact 编辑行为不回归。
- 右键只有一个 crossfade 编辑入口，禁用状态仍能进入面板。
- 浮动面板在视口四角、窄窗口、滚动、缩放、面板重排时可访问，不被裁切。
- 指针拖动、键盘调整、完成、Escape、外部点击、对象删除和焦点恢复有一致历史行为。
- 明暗主题、中文英文、低/高缩放和 1×/2× 像素密度下边框无圆角 gap 或重复描边。
- 保存重开、撤销重做、关闭预览后导出仍与 edited 计划一致。

实现阶段运行仓库 npm run format、npm run check，并按 agent-testing 技能通过 Docker MCP 运行 baseline 和新增行为场景。
任何不可运行的检查明确记录原因，不用单元测试代替声称完成真实 UI/音频验收。
本次仅交付设计文档，不声称已实现或已完成产品验收。

## 11. 评审交接

书面设计确认后再编写 docs/superpowers/plans 下的具体实现计划。
计划按机械命名迁移、模型与纯计划、实时/导出执行、UI 与验收拆分可验证任务，并保持语义依赖顺序。
计划评审和执行方式选择遵循 Superpowers writing-plans 流程。
