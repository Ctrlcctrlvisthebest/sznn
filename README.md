# Entry Draw Tool

这是一个临时互动抽奖网页工具。参与者提交一组角色要素，管理员统一开奖，系统会把每个字段分别随机抽取并组合成结果。

这个版本已经改成 **Cloudflare Workers + Static Assets + Workers KV**，可以部署到 Cloudflare Workers。

## 当前规则

- 参与者提交字段：`提交人`、`头`、`躯干`、`上肢`、`下肢`、`自由特征 1`、`自由特征 2`、`性格`
- 用户不需要填写“词条名称”，后台会自动生成内部名称，例如 `小明 的词条 #3`
- 开奖时不是抽整条提交，而是每个字段分别随机
- 同一个字段值可以被多人抽到，没有“只能被抽一次”的限制
- 管理员可以设置某个字段值“全员禁抽”
- 管理员可以设置某个参与者不能抽到某个字段值
- 禁抽是精确到单个字段的，例如禁掉 `头：灰短发` 不会禁掉同一提交里的 `躯干` 或 `性格`
- 开奖后会锁定提交，管理员可以重置结果后重新开奖

## 项目结构

```text
public/
  index.html      参与者提交页
  admin.html      管理员后台页面
  main.js         提交页和查询页的前端逻辑
  admin.js        后台管理前端逻辑
  styles.css      页面样式

src/
  worker.js       Cloudflare Workers 入口，包含 API、开奖逻辑、KV 数据读写
  server.js       旧 Node/Express 版本，保留给参考
  db.js           旧本地 JSON 数据层，保留给参考
  draw.js         旧本地开奖逻辑，保留给参考

wrangler.toml     Cloudflare Workers 配置
```

## 本地运行 Cloudflare Worker

需要 Node.js 20+。

第一次安装依赖：

```bash
pnpm install
```

复制本地环境变量文件：

```bash
cp .dev.vars.example .dev.vars
```

然后打开 `.dev.vars`，设置：

```text
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一串很长的随机字符串
```

启动本地 Cloudflare Worker：

```bash
pnpm dev
```

Wrangler 会显示一个本地地址，通常类似：

```text
http://localhost:8787
```

管理员后台：

```text
http://localhost:8787/admin
```

## 部署到 Cloudflare Workers

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 创建 KV namespace

```bash
npx wrangler kv namespace create DATA
```

命令会输出类似：

```toml
[[kv_namespaces]]
binding = "DATA"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

把输出里的 `id` 复制到 `wrangler.toml`，替换：

```toml
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
```

### 3. 设置线上密钥

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

第一个填后台密码，第二个填一串很长的随机字符串。

### 4. 部署

```bash
pnpm deploy
```

部署完成后，Cloudflare 会给一个 `.workers.dev` 地址。参与者访问根地址，管理员访问 `/admin`。

## 注意事项

- 现在数据保存在 Cloudflare KV 里，不再使用本地 `data/store.json`
- KV 很适合临时测试，但它不是强事务数据库；如果很多人同一秒同时提交，极端情况下可能有写入覆盖风险
- 一天测试、小规模试用通常没问题；正式活动如果很看重数据安全，建议之后换 D1 或 Durable Object
- `.dev.vars` 里有密码，不要提交到 GitHub
- `wrangler.toml` 里的 KV namespace id 可以提交，它不是密码

## 参考

- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare KV bindings: https://developers.cloudflare.com/kv/concepts/kv-bindings/
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
