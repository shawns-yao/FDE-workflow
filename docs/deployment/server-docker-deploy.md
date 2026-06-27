# 服务器 Docker 部署说明

本文记录 FDE Workstation 第一阶段线上部署方式。当前目标是先把控制面服务、Redis Streams、飞书 SDK 长连接和 Nginx 反向代理跑成可长期运行的容器化服务。

第一阶段不部署 k3s、Tekton、ArgoCD。它们属于后续交付链路阶段。

## 1. 部署形态

```text
Feishu Open Platform
  <- fde-workstation SDK WebSocket long connection

Internet / GitLab / Tekton / ArgoCD
  -> Nginx
  -> fde-workstation:3412

fde-workstation
  -> Redis Streams
```

服务器公网只开放：

```text
22/tcp
80/tcp
443/tcp
```

容器内部端口不直接暴露公网：

```text
3412  FDE Workstation
6379  Redis
```

飞书事件入口默认使用 SDK 长连接。服务端主动向飞书建立 WebSocket 连接，只需要服务器能出站访问 443 端口，不需要为飞书事件入口开放公网入站端口、域名或证书。

## 2. 文件说明

```text
Dockerfile
.dockerignore
docker-compose.prod.yml
deploy/nginx/conf.d/fde.conf
.env.production.example
```

说明：

- `Dockerfile` 使用 Node.js 22 Alpine 构建 TypeScript，并在运行阶段执行 `node dist/src/main.js`。
- `docker-compose.prod.yml` 启动 `redis`、`fde-workstation`、`nginx` 三个服务。
- `deploy/nginx/conf.d/fde.conf` 负责把 `/health`、`/ready` 和非飞书 `/webhook/*` 转发到 FDE 服务。
- `.env.production.example` 是生产环境变量模板，真实 `.env.production` 不提交仓库。

## 3. 服务器前置条件

服务器已完成：

```text
fde 用户私钥登录
sudo 权限验证
UFW 只开放 22 / 80 / 443
fail2ban sshd jail 启用
```

安装 Docker Engine 和 Compose 插件后，确认：

```bash
docker --version
docker compose version
```

`fde` 用户需要加入 `docker` 组。加入后要重新登录 SSH：

```bash
sudo usermod -aG docker fde
```

## 4. 生产环境变量

在服务器项目目录中创建：

```bash
cp .env.production.example .env.production
nano .env.production
```

必须填写：

```text
FDE_ENVIRONMENT=prod
FDE_EVENT_BACKEND=redis
REDIS_URL=redis://redis:6379/0
FEISHU_MODE=openapi_bot
FEISHU_EVENT_MODE=websocket
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_TEST_CHAT_ID= 或 FEISHU_DEFAULT_CHAT_ID=
```

`FEISHU_APP_SECRET` 等密钥只放服务器 `.env.production`，不能提交仓库。

只有在兼容 HTTP 回调模式时，才需要额外填写：

```text
FEISHU_EVENT_MODE=http_callback
FEISHU_CALLBACK_VERIFICATION_TOKEN=
FEISHU_CALLBACK_SIGNING_SECRET=
```

## 5. 启动服务

构建并启动：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

查看状态：

```bash
docker compose -f docker-compose.prod.yml ps
```

查看日志：

```bash
docker compose -f docker-compose.prod.yml logs -f fde-workstation
```

## 6. 健康检查

本机验证：

```bash
curl -fsS http://127.0.0.1/health
curl -fsS http://127.0.0.1/ready
```

预期：

```json
{"status":"ok","service":"fde-workstation","environment":"prod"}
```

`/ready` 会检查 Redis。如果 Redis 不可用，返回非 200。

## 7. Nginx 与 HTTPS

当前 `deploy/nginx/conf.d/fde.conf` 是 HTTP 反向代理配置，适合先验证容器链路。

飞书 SDK 长连接模式不需要 HTTPS 回调地址。Nginx 和 HTTPS 主要用于：

```text
1. /health 和 /ready 对外探活
2. GitLab / Tekton / ArgoCD 等外部 webhook
3. FEISHU_EVENT_MODE=http_callback 兼容模式
```

HTTPS 可以通过以下方式之一完成：

```text
方式一：Cloudflare / 云厂商负载均衡在外层终止 HTTPS，再转发到服务器 80 端口
方式二：在服务器上为 Nginx 配置正式证书，再开放 443
```

在没有 HTTPS 前，不要把 GitLab、Tekton、ArgoCD 或飞书 HTTP 回调地址切到该服务器。飞书长连接模式不受这个限制。

## 8. 飞书长连接验证

服务启动后，先验证公网健康检查：

```bash
curl -fsS http://服务器公网IP/health
```

飞书开放平台中事件订阅选择长连接模式，并订阅消息事件和卡片交互事件。服务启动后查看日志：

```bash
docker compose -f docker-compose.prod.yml logs -f fde-workstation
```

应能看到项目服务启动日志和飞书事件入口启动日志：

```text
started
feishu_event_ingress_started
```

SDK 自身还会输出 WebSocket 连接成功相关日志。随后在飞书测试群中 @ 机器人，或点击带 `acknowledge` 的卡片按钮，事件应进入 Redis Streams。

如果切换为兼容 HTTP 回调模式：

```text
FEISHU_EVENT_MODE=http_callback
```

完成 HTTPS 后，把飞书后台卡片回调地址设置为：

```text
https://你的域名/webhook/feishu/callback
```

再发送带“确认收到”按钮的卡片，点击后确认日志：

```bash
docker compose -f docker-compose.prod.yml logs -f fde-workstation
```

应能看到飞书回调被处理，并进入事件总线。

## 9. 本地 Docker 验证

本地也可以使用同一套 Compose，但需要准备 `.env.production`。如果只是验证 Redis，可继续使用仓库根目录的 `docker-compose.yml`：

```bash
docker compose up -d redis
```

如果要验证完整容器链路：

```bash
cp .env.production.example .env.production
# 填写必要变量，或临时使用 dev 配置测试
docker compose -f docker-compose.prod.yml up -d --build
```

## 10. 停止和更新

停止：

```bash
docker compose -f docker-compose.prod.yml down
```

保留 Redis 数据。不要随意删除 volume。

更新：

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 11. 当前边界

已纳入第一阶段：

```text
Docker 构建
Redis 容器持久化
Nginx HTTP 反向代理
飞书 SDK 长连接事件入口
生产环境变量模板
生产启动配置校验
/health
/ready
请求体大小限制
```

尚未纳入第一阶段：

```text
Nginx 自动签发证书
k3s
Tekton
ArgoCD
正式 GitOps 仓库联调
飞书事件回流后的业务状态流转
```
