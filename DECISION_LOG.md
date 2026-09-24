# Phase 0 原型决策记录（DECISION_LOG）

记录纵向切片中的关键取舍，供 Phase 1 回顾。日期：2026-09-23。

## 1. 样板与热点规模

- **决策**：4 张客厅样板（奶油风 / 原木侘寂 / 现代简约 / 轻奢），每样板 2 个热点，每热点 2 条快捷指令。
- **理由**：用户任务要求 4–6 个样板；4 张足以覆盖主路径与风格差异，图片生成与调试成本最低。
- **代价**：计划 PDF 泛化建议 8–12 个样板；Phase 1 需扩充并引入上传。

## 2. 遮罩方案：SVG bbox 而非 SAM

- **决策**：热点用相对坐标 bbox，前端 SVG 绘制虚线框 + 可点击按钮。
- **理由**：Phase 0 模拟选择器（MockMask）；bbox 足以表达「点选对象」，实现与调试成本最低。
- **预留**：`lib/adapters.ts` 定义 `SelectorAdapter` 接口，Phase 1 替换为 SAM 点选/框选。

## 3. 自由文本：关键词映射而非模型生成

- **决策**：自由文本按关键词匹配到该热点的两张预生成结果之一，不调用任何模型。
- **理由**：明确标注演示模式；避免不可控的生成质量干扰商业模式验证。
- **预留**：`EditAdapter` 接口，Phase 1 替换为真实 Image Edit。

## 4. 任务驱动：进程内 setTimeout worker

- **决策**：charged → processing（2.5s）→ 终态（3.5s）全部用进程内 setTimeout 驱动，无外部队列。
- **理由**：Phase 0 单机演示，无需引入队列基础设施；状态机转换有严格校验。
- **代价**：服务重启会中断内存中的定时器 → 由 `recoverStaleJobs()` 兜底（见 7）。

## 5. 失败退款：5 秒自动退（计划要求 1 分钟内）

- **决策**：failed 后 5 秒自动 refund，演示节奏快且满足「1 分钟内退款」。
- **理由**：演示时可完整看到 失败 → 退点中 → 已退回 的全过程。

## 6. 点数账本：只追加、不存余额

- **决策**：`point_ledger` 只追加流水，余额 = `SUM(delta)`；`idem_key` 唯一约束防重复流水。
- **理由**：账本可审计；幂等提交（同一 idempotency_key）只产生一笔 charge。
- **验证**：E2E 断言「流水之和 == 接口返回余额」始终成立。

## 7. 重启恢复：stale 任务标记失败并退点

- **决策**：启动时把 `created/charged/processing` 的遗留任务标记 `failed(server_restart)` 并退点。
- **理由**：进程内 worker 的定时器在重启后丢失，必须保证账本不亏空用户点数。
- **实现注意**：`edit_job` 表不存 `session_id`，恢复时经 selection → asset → project 联表取得。

## 8. 演示标识策略：三层标注

- **决策**：
  1. 页面顶部常驻「演示模式」横幅；
  2. 16 张预生成结果图本体烘焙底部水印「演示模式 DEMO · 非真实生成」；
  3. 前端结果区角标 + PNG 下载时 canvas 二次写入水印。
- **理由**：直接访问图片 URL 也能看到标识，避免「模拟结果被误认为真实生成」。

## 9. 模拟结果不上传、不落库原图

- **决策**：只做 4 张样板（P0），不做用户上传、账号、支付、真实 AI、3D、Scene JSON、商品库。
- **理由**：用户明确要求只做 P0、不扩展 Non-goals。

## 10. 常量拆分：lib/constants.ts

- **决策**：`POINTS_PER_EDIT` 等前后端共享常量独立成 `lib/constants.ts`，不引入服务端依赖。
- **理由**：`app/page.tsx`（客户端组件）曾直接 import `@/lib/jobs`，导致 `node:sqlite` 被打进浏览器 bundle，生产构建失败。拆分后构建通过。

## 11. 埋点：隐私最小化

- **决策**：事件只记录类型/长度/任务标识（`prompt_type`、`prompt_length`），不记录完整提示词、原图、个人信息。
- **事件字典**：demo_started / asset_ready / selection_confirmed / edit_submitted / edit_completed / edit_failed / compare_used / second_edit_started。
- **修正**：`asset_ready` 初版只在前端上报，E2E 发现缺失后改为后端 `/api/assets` 在传入 session_id 时记录。

## 12. 刷新恢复

- **决策**：localStorage 存 session_id（恢复会话与余额，不重复赠点）+ 未完成 job id（刷新后自动续轮询）。
- **理由**：满足「页面刷新后状态可恢复」；终态任务清除本地记录。

## 13. 点选分割：Replicate SAM 换成阿里云图像分割（AI_PROVIDER=aliyun）

- **决策**：新增 `AliyunSelectorAdapter`（视觉智能开放平台 `SegmentCommonImage`，RPC + AccessKey 签名），
  `AI_PROVIDER=aliyun` 为国内默认推荐（阿里云分割 + 火山即梦改图，全国内链路）；Replicate SAM 代码保留但标记
  `@deprecated`，不再推荐（需外币支付方式的国外账号）。
- **理由**：用户要求砍掉 Replicate 依赖。阿里云通用分割覆盖家具/植物等场景；返回合并前景时，
  本地用 alpha 通道转二值 mask + 连通域分析取出点击点所在实例（无额外 API 成本）。
- **代价/限制**：`ImageURL` 必须公网可访问——http(s) 图片直接可用，本地上传照片需配
  `ALIYUN_IMAGE_BASE_URL`（OSS/内网穿透映射 public 目录），未配置时 502 明确报错；
  单价未在公开文档中查到，`COST_ALIYUN_SEGMENT_CNY` 为占位估算并标 `[待核对]`；
  `Version`/`RegionId`/分辨率上限等口径待真 key 首次运行前人工核对。
- **验证**：tsc + 生产构建通过；mock 路径 E2E 35/35 全过；无 key 时 `/api/selections` 返回 502
  `mask_unavailable`（中文原因），余额未扣，未发起任何网络调用。
