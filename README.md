# Entry Draw Tool

这是一个 Python / Flask 做的临时互动抽奖网页工具。参与者提交一组角色要素，管理员统一开奖，系统会把每个字段分别随机抽取并组合成结果。

数据保存在本地文件：

```text
data/store.json
```

## 当前规则

- 参与者提交字段：`提交人`、`头`、`躯干`、`上肢`、`下肢`、`自由特征 1`、`自由特征 2`、`性格`
- 用户不需要填写“词条名称”，后台会自动生成内部名称，例如 `小明 的词条 #3`
- 每个写签人名字只能提交一次；忽略名字首尾空格及英文字母大小写后，重复名字会被拒绝
- 开奖时不是抽整条提交，而是每个字段分别随机
- 第一次统一抽取按“投稿 ID + 部位”标记使用状态；同一份投稿的同一部位只能使用一次，不同投稿中的相同文字可分别出现
- 第一次统一抽取时，如果参与者名字和某个提交人的名字一致，这个人的结果里会随机选 1 个槽位使用自己提交过的对应槽位内容，同时仍遵守不重复规则
- 参与者可以供奉整支签并固定所有特征；供奉后不能献祭、支线删除或参与打架
- 管理员可以设置某个字段值“全员禁抽”
- 管理员可以设置某个参与者不能抽到某个字段值
- 禁抽是精确到单个字段的，例如禁掉 `头：灰短发` 不会禁掉同一提交里的 `躯干` 或 `性格`
- 抽取完成后，管理员可以记录打架：胜者抢走败者对应部位的词条，败者变成“无”，胜者被替换的旧词条进入第二轮池
- 管理员可以为部分参与者解锁一次支线；参与者删除一个自己的部位词条后，该部位变成“普通人类”，原词条进入第二轮池
- 管理员开启第二轮献祭后，参与者至少献祭一个可用部位，也可以一次献祭多个；“无”“普通人类”和待重抽部位不能献祭
- 未献祭部位保持固定；献祭词条进入第二轮池，并且献祭者不能重新抽回自己献祭的词条
- 第二次抽取由管理员统一执行且只使用第二轮池；第二轮为有放回抽取，不同参与者可以获得相同的部位词条，第二轮也可重复开启
- 开启第二轮时会清空第一轮使用标记，但不会把原始提交池加入第二轮；第二轮的数据来源仍严格限定为第二轮池
- 参与者只要提交献祭并满足本轮仪式条件，第二张签的全部 7 个部位都会从第二轮池重新抽取；没有提交献祭的人完全不受影响，无论其签是否供奉
- 第二轮按部位分别统计献祭人数，每个部位至少需要 2 人献祭；不要求所有参与者献祭同一部位。不足 2 人时该部位仪式失败，献祭词条不返还且该部位变成“无”
- 第二次抽取成功后，查询页显示两张独立的签：第一张保留未献祭部位、献祭部位为“无”；第二张只显示本轮重新抽到的部位，其他部位为“无”
- 管理后台会同时显示第二轮当前可抽池和历次结算记录；抽中的词条从可抽池移出，但记录会保留以支持核对重复轮次
- 第二次抽取完成后仍可由管理员记录打架，规则与第一次抽取后相同
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
