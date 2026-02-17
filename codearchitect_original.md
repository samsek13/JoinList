# 代码架构蓝图：Time-Balanced Playlist Mixer (V1.0)

1. 系统分层架构 (Layered Architecture)

--------------------------------

为了实现解耦，我们将系统分为四个逻辑层：

* **接入层 (API Layer)**：处理 HTTP 请求，管理用户鉴权，下发/查询异步任务。

* **任务编排层 (Service/Orchestration Layer)**：管理任务生命周期（创建、排队、进度更新），协调各组件工作。

* **核心领域层 (Domain Layer)**：包含通用的 **Provider 接口定义** 和 **Mixer 均衡算法**。

* **基础设施层 (Infrastructure Layer)**：包含网易云 API 的具体实现、SQLite 数据库操作、Redis 任务队列。

* * *

2. 核心模块定义

---------

### 2.1 Music Provider 模块 (插件化设计)

这是解耦的关键。我们定义一个接口 `IMusicProvider`，所有平台必须实现它。

* **`IMusicProvider` (Interface)**:
  
  * `searchPlaylists(ids)`: 获取原始歌单详情。
  
  * `fetchPlaylistTracks(id)`: 获取歌单内所有歌曲（含时长、歌手）。
  
  * `createPlaylist(name, trackIds)`: 在用户账号下创建新歌单。

* **`NeteaseProvider` (Implementation)**: 封装 `NeteaseCloudMusicApi` 的逻辑，处理网易云特有的分页请求和 Cookie 注入。

### 2.2 Mixer Engine 模块 (算法核心)

该模块纯粹处理数学逻辑，不感知网易云或 Spotify 的存在。

* **输入**：`TrackPool[]` (去重后的歌曲池), `TargetTotalTime` (目标总时长)。

* **处理逻辑**：
  
  1. 计算单源目标上限：
     $$t_{target} = \min \left( \frac{T_{max}}{N}, D_1, D_2, \dots, D_N \right)$$
  
  2. **Shuffle 策略**：对每个 Pool 进行随机洗牌。
  
  3. **时量贪心匹配**：在 $t_{target}$ 约束下，为每个 Pool 选出最接近目标的歌曲集合。

* **输出**：`FinalTrackList` (最终确定的歌曲 ID 序列)。

### 2.3 Task Queue 模块 (异步处理)

使用 **BullMQ (Node.js)** 或 **Celery (Python)** 等工具。

* **Producer (生产者)**：接收用户请求，生成 `TaskID` 并写入 SQLite，同时将任务推入队列。

* **Worker (消费者)**：
  
  1. 从队列取出任务。
  
  2. 调用 `Provider` 抓取数据（带频率限制控制）。
  
  3. 调用 `Mixer Engine` 计算。
  
  4. 调用 `Provider` 回写歌单。
  
  5. 更新 SQLite 中的任务状态为 `Completed`。

* * *

3. 数据库模型 (SQLite)

-----------------

即使是轻量级工具，良好的数据结构也能避免逻辑混乱：

* **Users 表**：存储 `userId`, `platform` (网易云), `cookie`, `lastLoginTime`。

* **Tasks 表**：存储 `taskId`, `ownerId`, `status` (Pending/Processing/Success/Failed), `progress` (0-100), `resultUrl` (生成的歌单链接), `errorMessage`。

* * *

4. 关键交互流程图 (Data Flow)

----------------------

1. **用户** 发起 `POST /mix` 接口。

2. **API** 校验 Cookie 有效性，在 **SQLite** 创建一条状态为 `Pending` 的记录。

3. **API** 将 `{taskId, sourceListIds, targetTime}` 丢入 **Redis/MessageQueue**，立即给前端返回 `taskId`。

4. **Worker** 监控到新任务：
   
   * **Step A**: 循环调用 `Provider.fetchPlaylistTracks`。**注意：** 每抓取完一个歌单，更新一次 `Tasks.progress`。
   
   * **Step B**: 执行 `Mixer.calculate()`。
   
   * **Step C**: 调用 `Provider.createPlaylist`。

5. **前端** 每隔 2 秒调用 `GET /task/:taskId` 轮询进度并展示给用户。

* * *

5. 解耦亮点说明

---------

* **平滑扩展**：当你需要增加 Spotify 时，只需要：
  
  1. 新建 `SpotifyProvider.ts` 实现接口。
  
  2. 在 API 层增加一个 `platform` 参数判定。
  
  3. **核心 Mixer 算法和 Task 调度逻辑一行代码都不用改。**

* **健壮性**：如果网易云接口由于网络波动超时，Worker 拥有重试机制 (Retry Policy)，且不会阻塞主 Web 线程。

* **去重解耦**：去重逻辑被放置在 `Mixer` 的预处理阶段，与具体的平台 API 隔离。

* * *

6. 技术栈建议

--------

* **语言**：TypeScript (强类型对这种多模块交互非常友好)。

* **框架**：NestJS (自带解耦基因，非常适合 Provider 模式)。

* **任务处理**：BullMQ + Redis。

* **持久化**：Prisma (ORM) + SQLite。

* **网易云驱动**：`NeteaseCloudMusicApi`。
