# 代码架构文档：JoinList (20260217版)

## 1. 架构概览

JoinList 采用经典的 **Node.js 后端分层架构**，前端为静态页面（由后端托管）。系统设计核心在于**异步任务处理**，以应对耗时的音乐 API 操作。

### 技术栈
*   **Runtime**: Node.js (TypeScript)
*   **Web Server**: Express
*   **Database**: SQLite (通过 Prisma ORM 访问)
*   **Queue**: BullMQ (支持 Redis 或 In-Memory 降级)
*   **External API**: NeteaseCloudMusicApi
*   **Frontend**: 原生 HTML/JS/CSS (位于 `public/`)

---

## 2. 目录结构与文件角色详解

以下是 `src/` 目录下所有 TypeScript 文件的详细角色说明：

### 2.1 核心入口与配置
*   **`server.ts`**
    *   **角色**：Web 服务器入口。
    *   **职责**：
        *   启动 Express 应用。
        *   配置中间件 (CORS, JSON Body Parser)。
        *   定义 API 路由 (`POST /api/mix`, `GET /api/task/:id`)。
        *   托管前端静态文件 (`public/`)。
        *   处理请求验证 (Zod Schema) 和任务创建逻辑。

*   **`types.ts`**
    *   **角色**：类型定义中心。
    *   **职责**：定义全项目通用的 TypeScript 接口，如 `Track` (歌曲), `TrackPool` (歌单池), `MixConfig` (混音配置), `MixResult` (结果统计)。

*   **`utils.ts`**
    *   **角色**：通用工具库。
    *   **职责**：提供无副作用的纯函数。
    *   **核心函数**：
        *   `sleep`, `randomInt`: 流程控制辅助。
        *   `shuffle`: 数组随机打乱（洗牌算法）。
        *   `parsePlaylistId`, `resolvePlaylistIds`: 处理复杂的歌单链接解析。
        *   `normalizeSign`: 生成歌曲指纹用于去重。
        *   `hashCookie`: 生成用户唯一标识。

### 2.2 数据层 (Data Layer)
*   **`db.ts`**
    *   **角色**：数据库单例。
    *   **职责**：初始化并导出 `PrismaClient` 实例，确保全局复用同一个数据库连接。

### 2.3 业务逻辑层 (Domain Layer)
*   **`mixer.ts`**
    *   **角色**：核心混音引擎（纯逻辑）。
    *   **职责**：
        *   实现“时间均衡”算法。
        *   **输入**：一组歌单池 (`TrackPool[]`) 和目标时长。
        *   **输出**：选中的歌曲 ID 列表和统计信息。
        *   **特点**：不包含任何 IO 操作，便于测试。

*   **`mixJob.ts`**
    *   **角色**：任务处理器（业务流程编排）。
    *   **职责**：
        *   `processMixTask(taskId)`: 定义一个混音任务的具体执行步骤。
        *   **流程**：读取任务 -> 初始化 Provider -> 抓取所有源歌单 -> 执行去重 -> 调用 `mixer` 计算 -> 创建新歌单 -> 更新数据库状态。
        *   处理异常情况（如 Cookie 失效）并更新任务状态。

### 2.4 基础设施层 (Infrastructure Layer)
*   **`queue.ts`**
    *   **角色**：消息队列封装。
    *   **职责**：
        *   封装 BullMQ 的 `Queue` 实例。
        *   **智能降级**：根据环境变量 `QUEUE_MODE` 决定是连接 Redis 还是使用 `setImmediate` 进行内存内异步处理。
        *   提供 `enqueueMixTask` 函数供 Server 调用。

*   **`worker.ts`**
    *   **角色**：后台工作进程入口。
    *   **职责**：
        *   启动 BullMQ 的 `Worker`。
        *   监听任务队列，调用 `processMixTask` 处理具体任务。
        *   独立于 `server.ts` 运行（在生产环境中通常作为单独的进程）。

*   **`provider/netease.ts`**
    *   **角色**：网易云音乐服务提供者。
    *   **职责**：
        *   封装 `NeteaseCloudMusicApi` 的调用。
        *   处理分页逻辑（如 `fetchPlaylistTracks` 自动翻页抓取所有歌曲）。
        *   处理 API 异常和重试。
        *   提供统一的接口：`fetchPlaylistMeta`, `fetchPlaylistTracks`, `createPlaylist`。

---

## 3. 数据流转图 (Data Flow)

1.  **提交任务**：
    `Frontend` -> `POST /api/mix` -> `server.ts` -> (验证参数) -> `Prisma (Create Task)` -> `queue.ts (Add Job)` -> 返回 `taskId`。

2.  **任务处理**：
    `worker.ts` (监听队列) -> 获取 Job -> `mixJob.ts (processMixTask)`:
    *   -> `provider/netease.ts` (抓取数据)
    *   -> `mixer.ts` (计算选曲)
    *   -> `provider/netease.ts` (创建歌单)
    *   -> `Prisma (Update Task Status)`

3.  **状态查询**：
    `Frontend` -> (轮询) -> `GET /api/task/:id` -> `server.ts` -> `Prisma (Query Task)` -> 返回 JSON。

---

## 4. 关键设计决策

### 4.1 为什么使用 SQLite?
项目定位为单机或小规模部署工具，SQLite 零配置、单文件存储，足以支撑并发量不大的任务状态管理，且配合 Prisma 迁移方便。

### 4.2 为什么支持 Queue 降级?
为了降低开发和部署门槛。
*   **开发模式**：无需安装 Redis，直接运行 `npm run dev` 即可体验全流程（使用内存模拟队列）。
*   **生产模式**：使用 Redis 确保任务不丢失，支持多 Worker 并发。

### 4.3 为什么去重逻辑在 mixJob 中?
`mixer.ts` 被设计为纯数学计算模块。去重涉及到具体的业务规则（如“优先保留前面的歌单”），因此放在业务流程层 (`mixJob.ts`) 处理，计算层 (`mixer.ts`) 只接收处理好的干净数据。
