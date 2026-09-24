# AI改我家 · Phase 0 纵向切片原型

> **演示模式 DEMO**：本原型所有 AI 能力均为模拟。样板图、热点、修改结果均为预生成图片；
> 结果图本体与下载 PNG 均带有「演示模式」水印；点数为演示点数，不可充值。

Phase 0 可运行纵向切片：选样板 → 点选家具 → 输入指令 → 扣点确认 → 模拟生成 →
前后对比 → 再改一次，附点数账本与埋点看板。

## 运行方式

```bash
cd ~/workspace/goals/ai-12/prototype
npm install        # 首次
npm run build      # 生产构建（含类型检查）
npm start          # 一键启动，默认 http://localhost:3000
```

开发调试可用 `npm run dev`（Turbopack）。

## 演示主路径

1. 打开首页，顶部可见「演示模式」横幅与 30 点余额。
2. 选择一张客厅样板图。
3. 点击图片上的高亮热点（如沙发），可再次点击取消选中。
4. 点选快捷指令或输入 1–200 字修改描述。
5. 点击「生成效果图」，确认弹窗显示扣 5 点 → 确认。
6. 等待状态流转（排队中 → 生成中 → 成功），拖动滑杆对比前后。
7. 可「再改一次」（以上一版结果为底图）或「保存 PNG」（自动加演示水印）。

## 强制失败 / 退款演示

页面右下角「演示控制」面板：

- `强制失败`：下一次提交模拟服务异常 → 状态失败 → 约 5 秒后自动退 5 点。
- `模拟超时`：同上，错误类型为超时。
- 余额不足（0 点）时提交 → 402 提示，可点右上角「新会话」重新获得 30 点。

## 数据重置

```bash
rm -f data/prototype.db*
```

删除 SQLite 文件后重启即为全新状态（新会话重新获赠 30 点）。

## 自验脚本

```bash
# API 级 E2E（34 项：赠点/幂等/状态机/失败退款/402/埋点）
node e2e-test.mjs
```

UI 交互（点击/滑杆/移动端/键盘）需在真实浏览器中按「演示主路径」走一遍；
沙盒内 Chromium 因本地网络访问限制无法驱动，已用 SSR 结构检查 + 代码审查覆盖。

## 目录结构

```
app/
  page.tsx                 主界面（选样板/遮罩/指令/对比/账本/埋点）
  api/
    projects/route.ts      新建/恢复会话（新 session 赠 30 点）
    assets/route.ts        登记图片资产（记录 asset_ready）
    selections/route.ts    确认选区（经 SelectorAdapter）
    edit-jobs/route.ts     提交任务（校验+幂等+预扣点）
    edit-jobs/[id]/route.ts 任务状态查询
    points/ledger/route.ts 余额与流水
    events/route.ts        埋点上报/查询
lib/
  db.ts        SQLite（node:sqlite）+ 表结构 + 重启恢复
  samples.ts   4 样板 × 2 热点 × 2 指令/热点定义
  adapters.ts  Selector/Edit 适配器接口（Mock 实现，Phase 1 可替换）
  jobs.ts      任务状态机 + 进程内 worker + 失败自动退点
  ledger.ts    追加式点数账本（余额 = SUM(delta)）
  events.ts    事件字典（隐私最小化）
  constants.ts 前后端共享常量（客户端安全）
public/samples/  4 张样板图 + 16 张预生成结果图（均带演示水印）
```

## 接口速览

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | /api/projects | 新建/恢复会话，`{title?, session_id?}` |
| POST | /api/assets | 登记资产，`{project_id, session_id?, kind, uri}` |
| POST | /api/selections | 确认选区，`{asset_id, session_id, hotspot_id, project_id}` |
| POST | /api/edit-jobs | 提交任务，`{selection_id, session_id, hotspot_id, prompt, prompt_type, idempotency_key, force_fail?}` |
| GET | /api/edit-jobs/[id]?session_id= | 任务状态 |
| GET | /api/points/ledger?session_id= | 余额 + 流水 |
| POST/GET | /api/events | 埋点上报 / 查询 |
| POST | /api/uploads | 上传自家照片（multipart，`file`, `project_id?`, `session_id?`）→ asset |

## Phase 1 真实 AI（创始人自用 demo）

单用户范围：不做登录/支付/防刷/多用户。填自己的 key，上传自家照片，点选改图，全流程跑通。

```bash
cp .env.example .env.local   # 填入 key
# AI_PROVIDER=aliyun    # 国内默认推荐：阿里云图像分割点选 + 火山即梦改图（全国内链路）
# AI_PROVIDER=seedream  # 火山即梦改图，点选走 Replicate SAM（已废弃，需外币卡）
# AI_PROVIDER=gemini    # Gemini 改图，点选走 Replicate SAM（已废弃）
npm run build && npm start
```

### 国内点选分割：阿里云视觉智能开放平台 图像分割

- 接口：`SegmentCommonImage`（通用场景图像分割），endpoint `https://imageseg.cn-shanghai.aliyuncs.com/`，
  RPC + AccessKey 签名（HMAC-SHA1），国内账号即可，无需外币卡。
- 返回 `Data.ImageURL`（4 通道透明 PNG，有效期 30 分钟）；API 不区分多个实例，
  本地用 alpha 通道转二值 mask + 连通域分析取出点击点所在的实例。
- 官方文档（图像分割 API PDF，含通用场景语法与示例）：
  https://static-aliyun-doc.oss-cn-hangzhou.aliyuncs.com/download%2Fpdf%2F146441%2F%25E5%259B%25BE%25E5%2583%258F%25E5%2588%2586%25E5%2589%25B2_cn_zh-CN.pdf
- **公网 URL 约束**：阿里云要求 `ImageURL` 公网可访问。http(s) 图片直接可用；
  本地上传的照片需配置 `ALIYUN_IMAGE_BASE_URL`（把 public 目录映射到 OSS/内网穿透地址）；
  未配置时明确报错，不回退 Mock。

### 自用流程（curl）

```bash
# 1. 建会话拿 session 和 project（一次调用返回两者）
R=$(curl -s -X POST localhost:3000/api/projects -H 'Content-Type: application/json' -d '{}')
S=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
P=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['project']['id'])")
# 2a. 方式一：用公网图片地址（无需 ALIYUN_IMAGE_BASE_URL）
A=$(curl -s -X POST localhost:3000/api/assets -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$P\",\"session_id\":\"$S\",\"kind\":\"photo\",\"uri\":\"https://你的图床/客厅.jpg\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['asset']['id'])")
# 2b. 方式二：上传自家照片（需先配好 ALIYUN_IMAGE_BASE_URL 并保证公网可访问）
A=$(curl -s -X POST localhost:3000/api/uploads -F "file=@/path/客厅.jpg" -F "session_id=$S" | python3 -c "import sys,json;print(json.load(sys.stdin)['asset']['id'])")
# 3. 点选（相对坐标 0-1，如点沙发）：返回 selection（含 mask_uri）与分割成本
SEL=$(curl -s -X POST localhost:3000/api/selections -H 'Content-Type: application/json' \
  -d "{\"asset_id\":\"$A\",\"session_id\":\"$S\",\"point\":{\"x\":0.5,\"y\":0.6}}" | python3 -c "import sys,json;print(json.load(sys.stdin)['selection']['id'])")
# 4. 提交改图（扣 5 点演示点数）：状态机 created→charged→processing→succeeded 不变
curl -s -X POST localhost:3000/api/edit-jobs -H 'Content-Type: application/json' \
  -d "{\"selection_id\":\"$SEL\",\"session_id\":\"$S\",\"hotspot_id\":\"n/a\",\"prompt\":\"换成浅色布艺沙发\",\"prompt_type\":\"text\",\"idempotency_key\":\"$RANDOM\"}"
# 5. 轮询 /api/edit-jobs/[id]?session_id=$S 看 result_uri（落盘 public/edits）
```

### 成本记录

- `edit_job.actual_ai_cost`：真实改图调用成本（Seedream ¥0.22/张，Gemini ¥0）。
- 点选分割成本：在 `/api/selections` 响应 `cost_cny` 与服务端日志中明示，未并入 `actual_ai_cost`
  （选区与改图是两次独立调用）。阿里云分割单价[待核对]（代码中为占位估算约 ¥0.03/次，
  调用失败不计费）；Replicate SAM 约 ¥0.01/次（已废弃链路）。

### 诚实失败

key 缺失、分割/改图报错 → 任务走 `failed` → 约 5 秒后自动退点，错误信息原样返回。
**不静默回退 Mock**：`AI_PROVIDER` 设为真实链路但 key 缺失时，报错而非用模拟结果糊弄。
阿里云链路特有：`ALIYUN_IMAGE_BASE_URL` 未配置而使用本地图片时，`/api/selections`
直接返回 502 说明原因（ImageURL 必须公网可访问）。

### 首次运行前必须人工核对（[待核对] 清单）

`lib/real_adapters.ts` 中所有 `[待核对]` 注释，核心项：

1. **阿里云分割**：`SegmentCommonImage` 单价（以控制台“计费介绍”页为准，更新
   `COST_ALIYUN_SEGMENT_CNY`）；`ALIYUN_IMAGESEG_VERSION`（默认 `2019-12-30`）与
   `RegionId`（默认 `cn-shanghai`）的实时口径；通用分割分辨率上限；返回 PNG 与原图
   尺寸一致性假设（连通域分析按相对坐标映射）。
2. `REPLICATE_SAM_MODEL` 的 input 字段名（`point_coords`/`point_labels`）与输出形态，以模型页实时文档为准。（已废弃链路）
3. `SEEDREAM_MODEL` 默认 `"seedream-5-0"` 为占位，以火山方舟控制台实际模型 ID 为准；`mask` 字段为探针假设字段，验证它正是探针目的之一。
4. `GEMINI_MODEL` 默认二代；`responseModalities` 与 `inlineData` 解析口径以 AI Studio 实时文档为准。
