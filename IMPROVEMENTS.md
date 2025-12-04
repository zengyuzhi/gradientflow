# GradientFlow - 项目改进计划

## 概述

本文档记录项目改进计划和待办事项。已完成的功能已从列表中移除。

---

## 已完成功能 (归档)

### 前端
- [x] 组件拆分 (MessageBubble/ 目录化)
- [x] 消息虚拟化 (react-virtuoso)
- [x] 错误边界 (ErrorBoundary.tsx)
- [x] Markdown 支持 (react-markdown)
- [x] Emoji 选择器 (EmojiPicker.tsx)
- [x] 动画配置 (constants/animations.ts, ui.ts)
- [x] UI 细节完善 (DateSeparator, @提及)
- [x] 网络状态监控 (useNetworkStatus)
- [x] 设备性能检测 (useDevicePerformance)
- [x] 减少动画偏好 (useReducedMotion)
- [x] Agent 配置面板 (AgentConfigPanel.tsx)

### 后端/Agent
- [x] RAG 知识库服务 (rag_service.py + ChromaDB)
- [x] 多 Agent 管理 (multi_agent_manager.py)
- [x] 网络搜索工具 (DuckDuckGo 集成)
- [x] Agent 心跳追踪
- [x] 工具库 (tools.py - 上下文、搜索、RAG)
- [x] LLM 客户端动态配置 (query.py - 多 Provider 支持)

---

## 高优先级改进

### 1. 文件上传功能

**当前状态**: Paperclip 按钮存在但无功能

**实现计划**:
```typescript
// 后端: 使用 multer 处理文件上传
// 前端: FileUpload 组件 + 拖放支持

功能清单:
- [ ] 图片预览和上传
- [ ] 文件大小和类型验证 (10MB 限制)
- [ ] 上传进度显示
- [ ] 拖放上传支持
- [ ] 消息中显示文件附件
```

### 2. 暗色模式

**实现计划**:
```css
/* CSS 变量方案 */
[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --text-primary: #ffffff;
  --message-own-bg: #1e4d2b;
}
```

步骤:
- [ ] 在 index.css 添加暗色主题变量
- [ ] 创建主题切换 Context 和 Hook
- [ ] 在 Sidebar 添加主题切换按钮
- [ ] localStorage 持久化用户偏好

### 3. 消息搜索功能

**实现计划**:
- [ ] 前端搜索 UI (搜索框 + 结果高亮)
- [ ] 后端 `/messages/search` 端点
- [ ] 支持按内容、发送者、时间范围筛选
- [ ] 搜索结果跳转到对应消息

### 4. 消息编辑功能

**实现计划**:
- [ ] 后端 `PATCH /messages/:id` 端点
- [ ] 保存编辑历史 (editHistory 数组)
- [ ] 前端编辑 UI (双击进入编辑模式)
- [ ] 显示 "已编辑" 标识

---

## 中优先级改进

### 5. WebSocket 实时通信

**当前问题**: 使用轮询 (polling) 获取消息，延迟高

**改进方案**:
```typescript
// 使用 ws 库实现 WebSocket
// 好处: 低延迟、减少服务器负载、真正实时

实现步骤:
- [ ] 后端添加 WebSocket 服务器
- [ ] 实现消息广播机制
- [ ] 前端 WebSocket 客户端
- [ ] 断线自动重连
- [ ] 保留轮询作为降级方案
```

### 6. 通知系统

**功能**:
- [ ] 浏览器原生通知 (Notification API)
- [ ] 新消息通知
- [ ] @提及通知
- [ ] 通知权限请求 UI

### 7. 代码高亮

**当前**: Markdown 代码块无语法高亮

**改进**:
```tsx
// 使用 react-syntax-highlighter
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
```

- [ ] 集成 react-syntax-highlighter
- [ ] 支持常见语言高亮
- [ ] 代码块复制按钮

### 8. 单元测试覆盖

**当前状态**: 无测试

**计划**:
- [ ] 配置 Vitest + React Testing Library
- [ ] MessageBubble 组件测试
- [ ] ChatContext reducer 测试
- [ ] API 客户端测试
- [ ] 后端 API 集成测试

---

## 低优先级改进

### 9. 消息已读状态

- [ ] 后端 `POST /messages/:id/read` 端点
- [ ] readBy 数组记录已读用户
- [ ] 前端使用 IntersectionObserver 自动标记
- [ ] 已读/未读 UI 指示

### 10. 草稿保存

- [ ] localStorage 保存消息草稿
- [ ] 按 conversationId 区分草稿
- [ ] 切换会话时恢复草稿

### 11. 离线支持 (PWA)

- [ ] Service Worker 注册
- [ ] 消息本地缓存 (IndexedDB)
- [ ] 离线时队列消息
- [ ] 恢复在线时同步

### 12. 语音消息

- [ ] MediaRecorder 录音
- [ ] 音频上传和播放
- [ ] 录音波形可视化

---

## 后端架构改进

### 13. 安全性增强 (高优先级)

**输入验证**:
```javascript
// 使用 zod 验证
const messageSchema = z.object({
  content: z.string().min(1).max(5000),
  // ...
});
```

- [ ] 安装并配置 zod
- [ ] 验证所有 API 输入
- [ ] 添加 XSS 防护

**速率限制**:
```javascript
// 使用 express-rate-limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
});
```

- [ ] 安装 express-rate-limit
- [ ] 登录/注册限流
- [ ] 消息发送限流

**安全 Headers**:
- [ ] 安装 helmet
- [ ] 配置 CSP
- [ ] 启用 HSTS

### 14. 性能优化 (中优先级)

**内存索引**:
- [ ] 用户 ID → User 映射
- [ ] 消息 ID → Message 映射
- [ ] 会话 → 消息列表映射

**响应压缩**:
- [ ] 安装 compression 中间件

**基于游标的分页**:
- [ ] 替换 slice(-limit) 为游标分页
- [ ] 返回 nextCursor 和 hasMore

### 15. 代码模块化 (中优先级)

**建议结构**:
```
server/
├── src/
│   ├── config/       # 环境变量配置
│   ├── middleware/   # 认证、验证、错误处理
│   ├── routes/       # 路由模块
│   ├── services/     # 业务逻辑
│   └── app.js        # Express 应用
└── server.js         # 入口
```

### 16. 日志系统 (中优先级)

- [ ] 安装 winston
- [ ] 配置日志级别
- [ ] 请求日志
- [ ] 错误日志
- [ ] 日志文件轮转

### 17. TypeScript 迁移 (低优先级)

- [ ] 添加 tsconfig.json (后端)
- [ ] 逐步迁移 server.js
- [ ] 类型定义与前端共享

### 18. Docker 部署 (低优先级)

- [ ] Dockerfile
- [ ] docker-compose.yml
- [ ] 健康检查端点
- [ ] 环境变量模板

---

## Agent 服务改进

### 19. Agent 能力扩展

- [ ] 图片理解能力 (多模态)
- [ ] 代码执行沙箱
- [ ] 更多工具集成 (日历、天气等)

### 20. Agent 监控面板

- [ ] Agent 状态仪表板
- [ ] 响应延迟统计
- [ ] 错误率监控
- [ ] Token 使用统计

### 21. 流式响应

**当前**: Agent 回复一次性显示

**改进**:
- [ ] 后端 SSE 端点
- [ ] 前端流式渲染
- [ ] 打字机效果

---

## 优先级总结

### 高优先级 (立即实施)
1. [ ] 文件上传功能
2. [ ] 暗色模式
3. [ ] 消息搜索
4. [ ] 消息编辑
5. [ ] 输入验证和速率限制

### 中优先级 (近期实施)
6. [ ] WebSocket 实时通信
7. [ ] 通知系统
8. [ ] 代码高亮
9. [ ] 单元测试
10. [ ] 后端性能优化
11. [ ] 代码模块化
12. [ ] 日志系统

### 低优先级 (长期规划)
13. [ ] 消息已读状态
14. [ ] 草稿保存
15. [ ] 离线支持 (PWA)
16. [ ] 语音消息
17. [ ] TypeScript 后端迁移
18. [ ] Docker 部署
19. [ ] Agent 流式响应
20. [ ] Agent 监控面板

---

## 实施建议

1. **分阶段进行**: 按优先级逐步实施，避免大规模重构
2. **保持向后兼容**: 确保前后端 API 契约稳定
3. **充分测试**: 每个改进应有对应测试
4. **文档更新**: 同步更新 CLAUDE.md 和 README
5. **小步快跑**: 偏好小的、聚焦的改动
