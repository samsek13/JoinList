# 时间均衡歌单混音器

## 功能概览
- 多歌单按时长均衡抽取并生成新歌单
- 任务异步处理与进度查询
- 去重规则：标题 + 第一歌手一致即视为重复

## 环境依赖
- Node.js 20+
- SQLite（已内置）
- Redis（生产/默认队列模式）

## 安装与初始化
```bash
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
```

## 启动方式
### 使用 Redis 队列
```bash
npm.cmd run dev
npm.cmd run worker
```

### 无 Redis（内存队列）
```bash
$env:QUEUE_MODE="memory"
npm.cmd run dev
```

## 访问方式
浏览器打开：
```
http://localhost:3000
```

## 说明
- 需要提供网易云 Cookie 以创建歌单
- 支持完整歌单链接与 163cn.tv 短链接
