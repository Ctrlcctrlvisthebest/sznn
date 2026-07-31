# Entry Draw Tool

这是一个 Python / Flask 做的临时互动抽奖网页工具。参与者提交一组角色要素，管理员统一开奖，系统会把每个字段分别随机抽取并组合成结果。

数据保存在本地文件：

```text
data/store.json
```

## 当前规则

- 参与者提交字段：`提交人`、`头`、`躯干`、`上肢`、`下肢`、`自由特征 1`、`自由特征 2`、`性格`
- 用户不需要填写“词条名称”，后台会自动生成内部名称，例如 `小明 的词条 #3`
- 开奖时不是抽整条提交，而是每个字段分别随机
- 第一次统一开奖时，如果参与者名字和某个提交人的名字一致，这个人的结果里会随机选 1 个槽位，强制使用自己提交过的对应槽位内容
- 同一个字段值可以被多人抽到，没有“只能被抽一次”的限制
- 管理员可以设置某个字段值“全员禁抽”
- 管理员可以设置某个参与者不能抽到某个字段值
- 禁抽是精确到单个字段的，例如禁掉 `头：灰短发` 不会禁掉同一提交里的 `躯干` 或 `性格`
- 参与者可以在结果页固定当前结果；固定后，这组结果里的所有字段值会从之后的抽奖池移除
- 参与者可以在结果页献祭某一个字段值并为自己重抽；被献祭的字段值只会对这个参与者禁抽，其他人仍然可以抽到
- 管理员可以在后台固定或取消固定某个结果，也可以更换固定结果里的单个字段；这些会同步增减固定池里的字段值
- 管理员增减固定结果、取消固定、修改固定字段时，页面都会先弹出确认框，避免误操作
- 开奖后会锁定提交，管理员可以重置结果后重新开奖

## 本地运行

需要 Python 3.10+。

第一次运行：

```bash
cd /Users/zoeli/Desktop/w
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ADMIN_PASSWORD=sznnszl SESSION_SECRET=replace-with-a-long-random-string python app.py
```

之后每次运行：

```bash
cd /Users/zoeli/Desktop/w
source .venv/bin/activate
ADMIN_PASSWORD=sznnszl SESSION_SECRET=replace-with-a-long-random-string python app.py
```

打开：

```text
http://127.0.0.1:5000
```

管理员后台：

```text
http://127.0.0.1:5000/admin
```

## 修改管理员密码

本地运行时改命令里的 `ADMIN_PASSWORD`：

```bash
ADMIN_PASSWORD=你的新密码 SESSION_SECRET=replace-with-a-long-random-string python app.py
```

部署到服务器时，在服务器平台的环境变量里设置：

```text
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一串很长的随机字符串
```

## 部署到 Render / 普通服务器

Render 配置：

```text
Build Command: pip install -r requirements.txt
Start Command: gunicorn app:app
```

环境变量：

```text
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一串很长的随机字符串
```

如果平台没有持久磁盘，`data/store.json` 可能会在重启后丢失。正式活动建议用带持久磁盘的平台，或者之后换数据库。

## 项目结构

```text
app.py              Python / Flask 后端入口
requirements.txt   Python 依赖
Procfile           部署平台可用的启动命令
runtime.txt        Python 版本提示

public/
  index.html       参与者提交页
  admin.html       管理员后台页面
  main.js          提交页和查询页的前端逻辑
  admin.js         后台管理前端逻辑
  styles.css       页面样式

data/
  store.json       本地数据文件，不提交到 GitHub
```

## GitHub 提醒

`.gitignore` 已经排除了：

```text
.venv/
__pycache__/
data/
.env
.DS_Store
```

所以依赖环境、本地数据和密码不会被上传。
