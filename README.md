# Entry Draw Tool

这是一个临时互动抽奖网页工具。参与者提交一组角色要素，管理员统一开奖，系统会把每个字段分别随机抽取并组合成结果。

这个版本适合一天到一个月的小规模测试。数据默认保存在服务器本地的 `data/store.json`。

## 当前规则

- 参与者提交字段：`提交人`、`头`、`躯干`、`上肢`、`下肢`、`自由特征 1`、`自由特征 2`、`性格`
- 用户不需要填写“词条名称”，后台会自动生成内部名称，例如 `小明 的词条 #3`
- 开奖时不是抽整条提交，而是每个字段分别随机
- 同一个字段值可以被多人抽到，没有“只能被抽一次”的限制
- 管理员可以设置某个字段值“全员禁抽”
- 管理员可以设置某个参与者不能抽到某个字段值
- 禁抽是精确到单个字段的，例如禁掉 `头：灰短发` 不会禁掉同一提交里的 `躯干` 或 `性格`
- 开奖后会锁定提交，管理员可以重置结果后重新开奖

## 给技术朋友的快速运行方式

需要 Node.js 20+ 和 pnpm。

``` bash
pnpm install
pnpm dev
```

本地打开：

``` text
http://localhost:3000
```

管理员后台：

``` text
http://localhost:3000/admin
```

默认管理员密码是 `admin`。建议本地测试时创建 `.env`：

``` bash
cp .env.example .env
```

然后改：

``` text
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一串很长的随机字符串
```

## Render 一天测试部署

这个项目不能用 GitHub Pages，因为它需要后端保存提交和开奖结果。可以把代码传到 GitHub，然后用 Render 免费 Web Service 测一天。

Render 配置：

``` text
Build Command: pnpm install
Start Command: pnpm start
```

环境变量：

``` text
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一串很长的随机字符串
```

部署后访问 Render 给出的公网地址。管理员后台是在地址后面加 `/admin`。

## 项目结构

``` text
public/
  index.html      参与者提交页
  admin.html      管理员后台页面
  main.js         提交页和查询页的前端逻辑
  admin.js        后台管理前端逻辑
  styles.css      页面样式

src/
  server.js       Express 后端接口
  db.js           JSON 文件数据读写
  draw.js         随机组合开奖逻辑

data/
  store.json      运行后自动生成，本地数据文件，不提交到 Git
```

## 数据说明

`data/store.json` 里主要有这些数组：

- `participants`：参与者名单
- `entries`：用户提交的字段池
- `fieldBlocks`：全员禁抽的字段值
- `restrictions`：单人禁抽的字段值
- `results`：开奖结果

## 重要提醒

免费托管平台可能会休眠或重启，本地 JSON 数据有丢失风险。一天测试可以；正式活动建议换成真正数据库，或者部署到有持久磁盘的服务上。

如果要清空全部测试数据，可以停止服务后删除 `data/store.json`，再重新启动。
