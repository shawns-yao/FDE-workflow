# 服务器 SSH Key 登录与基础加固

本文记录个人演示服务器的 SSH 登录方式和基础加固流程。目标是使用普通用户 `fde` 登录服务器，日常通过 `sudo` 获取管理员权限，避免长期使用 `root` 远程登录。

## 1. 基本原则

SSH key 分为私钥和公钥：

```text
私钥：只保存在本机，供 Xshell 或 ssh 客户端使用，不能上传服务器或代码仓库
公钥：放到服务器用户的 authorized_keys 文件中，用于授权登录
```

建议服务器登录 key 与 GitLab / GitHub key 分开使用，避免仓库访问权限和服务器登录权限绑定在同一把 key 上。

## 2. 本机生成服务器专用 Key

在 Windows PowerShell 执行：

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\fde_server_ed25519 -C "fde-server"
```

生成后会得到：

```text
C:\Users\<用户名>\.ssh\fde_server_ed25519      私钥，给 Xshell 使用
C:\Users\<用户名>\.ssh\fde_server_ed25519.pub  公钥，放到服务器
```

查看公钥：

```powershell
type $env:USERPROFILE\.ssh\fde_server_ed25519.pub
```

需要复制整行公钥，格式类似：

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... fde-server
```

不要复制 PowerShell 提示符、命令文本或私钥内容。

## 3. 服务器创建普通用户

先使用云厂商提供的方式登录 `root`。不要在普通用户验证完成前禁用 root 登录。

在服务器执行：

```bash
apt update
apt install -y sudo
adduser fde
usermod -aG sudo fde
```

`adduser` 过程中需要设置 `fde` 用户密码。后续的 `Full Name`、`Room Number`、`Work Phone` 等字段只是用户备注，可以直接按回车跳过。

确认用户已创建并加入 `sudo` 组：

```bash
id fde
```

输出中应包含 `sudo`。

## 4. 写入服务器公钥

在服务器 `root` 会话中执行：

```bash
mkdir -p /home/fde/.ssh
nano /home/fde/.ssh/authorized_keys
```

在 `nano` 中粘贴本机 `.pub` 文件里的整行公钥。

保存方式：

```text
Ctrl + O
回车
Ctrl + X
```

然后修正权限：

```bash
chmod 700 /home/fde/.ssh
chmod 600 /home/fde/.ssh/authorized_keys
chown -R fde:fde /home/fde/.ssh
```

这些权限必须正确，否则 SSH 可能拒绝使用 `authorized_keys`。

## 5. Xshell 配置

新建 Xshell 会话：

```text
协议：SSH
主机：服务器公网 IP
端口：22
用户名：fde
认证方式：Public Key
```

在 Public Key 设置中选择私钥文件：

```text
C:\Users\<用户名>\.ssh\fde_server_ed25519
```

注意选择不带 `.pub` 的私钥文件。

如果私钥设置了 passphrase，连接时需要输入该 passphrase。如果生成 key 时没有设置 passphrase，密码栏可以留空。

## 6. 登录验证

使用 `fde` 用户连接成功后，执行：

```bash
whoami
sudo whoami
```

期望输出：

```text
fde
root
```

只有确认 `fde` 用户可以登录且可以执行 `sudo` 后，才能继续禁用 root 远程登录。

## 7. 禁用 Root 远程登录和密码登录

确认 `fde` 登录可用后，再执行：

```bash
sudo tee /etc/ssh/sshd_config.d/99-fde-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
EOF

sudo sshd -t
sudo systemctl restart ssh
```

如果系统 SSH 服务名是 `sshd`，使用：

```bash
sudo systemctl restart sshd
```

不要关闭当前已登录窗口。新开一个 Xshell 会话，用 `fde` 用户重新登录确认无误后，再退出旧窗口。

## 8. 防火墙最小开放

Ubuntu 可以使用 `ufw`：

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

云厂商安全组同步只开放：

```text
22/tcp   SSH
80/tcp   HTTP
443/tcp  HTTPS
```

不要直接向公网开放：

```text
6379  Redis
6443  Kubernetes API
3412  FDE Workstation Node 服务端口
```

这些服务后续应通过本机访问、内网访问或反向代理暴露。

## 9. 常见问题

### Xshell 提示 Unable to resolve host

说明会话的主机字段填成了会话名或错误域名。主机应填写服务器公网 IP，而不是 `PDE` 这类会话名称，也不是服务器内网 IP。

### 复制公钥时要复制多长

复制 `.pub` 文件输出的整行内容，包括：

```text
ssh-ed25519
中间的长串 key
末尾注释，例如 fde-server
```

不要复制 `.pub` 文件之外的命令提示符。

### adduser 填写用户信息时中断了

只要用户已经创建、密码已设置，并且 `id fde` 能查到用户，后续备注字段没有填写完整通常不影响登录。可以继续执行：

```bash
usermod -aG sudo fde
```

再配置公钥。

## 10. 当前部署建议

当前服务器建议作为个人演示环境的公网入口：

```text
FDE Workstation
Redis Streams
飞书 HTTP 回调
Caddy / Nginx HTTPS 反向代理
```

后续再部署轻量级 `k3s`、ArgoCD 和 Tekton。由于带宽较小，第一版建议本地构建镜像并推送到外部镜像仓库，服务器侧 Tekton 负责交付编排、GitOps 更新、ArgoCD 同步和飞书协同通知。
