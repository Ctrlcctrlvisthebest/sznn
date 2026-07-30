// cookie-parser 用来读取和签名管理员登录 cookie。
import cookieParser from "cookie-parser";
// Express 是这个项目的后端 HTTP 服务框架。
import express from "express";
// nanoid 用来生成管理员会话 token。
import { nanoid } from "nanoid";
// path 用来拼接 public 文件夹路径。
import path from "node:path";
// fileURLToPath 用来在 ES Module 里拿到当前文件路径。
import { fileURLToPath } from "node:url";
// 从数据层引入所有增删改查函数和内存数据对象。
import {
  addEntry,
  addParticipant,
  addRestriction,
  getSetting,
  removeEntry,
  removeParticipant,
  removeRestriction,
  resetResults,
  setFieldBlocked,
  store
} from "./db.js";
// 引入开奖逻辑。
import { runDraw } from "./draw.js";

// 后端和前端都需要知道字段 key 与中文名的对应关系。
const DRAW_FIELDS = [
  { key: "head", label: "头" },
  { key: "torso", label: "躯干" },
  { key: "upper_limbs", label: "上肢" },
  { key: "lower_limbs", label: "下肢" },
  { key: "feature_one", label: "自由特征 1" },
  { key: "feature_two", label: "自由特征 2" },
  { key: "personality", label: "性格" }
];

// 把字段 key 转成中文名，主要用于后台展示。
function getFieldLabel(fieldKey) {
  return DRAW_FIELDS.find((field) => field.key === fieldKey)?.label || fieldKey;
}

// 检查前端传来的字段 key 是否属于允许范围，避免写入乱字段。
function isValidField(fieldKey) {
  return DRAW_FIELDS.some((field) => field.key === fieldKey);
}

// 在 ES Module 中计算当前目录，相当于 CommonJS 里的 __dirname。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 创建 Express 应用实例。
const app = express();
// 读取端口；本地默认 3000，Render 等平台会通过 PORT 注入端口。
const port = Number(process.env.PORT || 3000);
// 管理员密码来自环境变量；没设置时本地默认 admin。
const adminPassword = process.env.ADMIN_PASSWORD || "admin";
// cookie 签名密钥来自环境变量；生产环境必须改成随机长字符串。
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret";
// 简单内存 session；服务重启后需要重新登录后台。
const sessions = new Set();

// 解析 JSON 请求体。
app.use(express.json({ limit: "1mb" }));
// 解析普通表单请求体。
app.use(express.urlencoded({ extended: true }));
// 启用带签名 cookie。
app.use(cookieParser(sessionSecret));
// 托管 public 文件夹里的静态网页。
app.use(express.static(path.join(__dirname, "..", "public")));

// 管理员接口保护中间件。
function requireAdmin(req, res, next) {
  // signedCookies 里有有效 session token 时允许继续。
  if (sessions.has(req.signedCookies.admin_session)) return next();
  // 否则返回 401。
  return res.status(401).json({ error: "需要管理员登录。" });
}

// 统一成功 JSON 响应格式。
function ok(res, data = {}) {
  res.json({ ok: true, ...data });
}

// 统一失败 JSON 响应格式。
function fail(res, error, status = 400) {
  res.status(status).json({ ok: false, error: error.message || String(error) });
}

// 管理员登录接口。
app.post("/api/admin/login", (req, res) => {
  // 密码不匹配就拒绝。
  if (req.body.password !== adminPassword) return fail(res, "密码不正确。", 401);
  // 生成一个新的会话 token。
  const token = nanoid(32);
  // 存到内存 session 集合里。
  sessions.add(token);
  // 把 token 写入带签名 cookie。
  res.cookie("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  ok(res);
});

// 管理员退出接口。
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  // 删除内存 session。
  sessions.delete(req.signedCookies.admin_session);
  // 清除浏览器 cookie。
  res.clearCookie("admin_session");
  // 返回成功。
  ok(res);
});

// 普通状态接口，前端可用来判断是否已开奖。
app.get("/api/state", (req, res) => {
  const drawLocked = getSetting("draw_locked", "0") === "1";
  const resultCount = store.results.length;
  ok(res, { drawLocked, resultCount });
});

// 参与者提交词条接口。
app.post("/api/entries", (req, res) => {
  // 提交人必填。
  const creatorName = String(req.body.creatorName || "").trim();
  if (!creatorName) return fail(res, "提交人必填。");
  // 已开奖后不允许继续提交。
  if (getSetting("draw_locked", "0") === "1") return fail(res, "已经开奖，不能继续提交词条。");

  // 收集七个字段，并去掉首尾空格。
  const fields = {
    head: String(req.body.head || "").trim(),
    torso: String(req.body.torso || "").trim(),
    upperLimbs: String(req.body.upperLimbs || "").trim(),
    lowerLimbs: String(req.body.lowerLimbs || "").trim(),
    featureOne: String(req.body.featureOne || "").trim(),
    featureTwo: String(req.body.featureTwo || "").trim(),
    personality: String(req.body.personality || "").trim()
  };
  // 七个字段都必填，否则某个字段池可能为空。
  if (Object.values(fields).some((value) => !value)) {
    return fail(res, "请填写完整的头、躯干、上肢、下肢、两个自由特征和性格。");
  }

  // 写入一条提交。
  const entry = addEntry({
    creatorName,
    ...fields
  });
  ok(res, { id: entry.id });
});

// 参与者按名字查询自己开奖结果。
app.get("/api/results/:name", (req, res) => {
  // 从 URL 里取名字。
  const name = String(req.params.name || "").trim();
  // 找到同名参与者。
  const participant = store.participants.find((item) => item.name === name);
  // 找到这个参与者的开奖结果。
  const result = participant && store.results.find((item) => item.participant_id === participant.id);
  // 拼出前端需要展示的结果对象。
  const row = result ? { participant_name: participant.name, title: `${participant.name} 的随机组合`, ...result } : null;
  // 没找到就提示名字不一致或还没开奖。
  if (!row) return fail(res, "没有找到结果。请确认名字完全一致，或等待管理员开奖。", 404);
  // 返回结果。
  ok(res, { result: row });
});

// 管理员后台一次性读取所有需要展示的数据。
app.get("/api/admin/overview", requireAdmin, (req, res) => {
  // 参与者按名字排序。
  const participants = [...store.participants].sort((a, b) => a.name.localeCompare(b.name));
  // 提交按新到旧排序。
  const entries = [...store.entries].sort((a, b) => b.id - a.id);
  // 把限制规则补上参与者名、字段名和值，方便前端显示。
  const restrictions = store.restrictions
    .map((restriction) => {
      const participant = store.participants.find((item) => item.id === restriction.participant_id);
      const entry = store.entries.find((item) => item.id === restriction.entry_id);
      return participant && entry
        ? {
            ...restriction,
            participant_name: participant.name,
            entry_title: entry.title,
            field_label: restriction.field_key === "all" ? "全部字段" : getFieldLabel(restriction.field_key),
            field_value: restriction.field_key === "all" ? "整条旧限制" : entry[restriction.field_key]
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.participant_name.localeCompare(b.participant_name));
  // 把开奖结果补上参与者名。
  const results = store.results
    .map((result) => {
      const participant = store.participants.find((item) => item.id === result.participant_id);
      return participant
        ? {
            participant_name: participant.name,
            entry_title: "随机组合",
            head: result.head,
            torso: result.torso,
            upper_limbs: result.upper_limbs,
            lower_limbs: result.lower_limbs,
            feature_one: result.feature_one,
            feature_two: result.feature_two,
            personality: result.personality
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.participant_name.localeCompare(b.participant_name));
  // 返回后台需要的一整包数据。
  ok(res, {
    participants,
    entries,
    restrictions,
    results,
    fieldBlocks: store.fieldBlocks.map((block) => {
      const entry = store.entries.find((item) => item.id === block.entry_id);
      return {
        ...block,
        field_label: getFieldLabel(block.field_key),
        field_value: entry?.[block.field_key] || "",
        entry_title: entry?.title || ""
      };
    }),
    fields: DRAW_FIELDS,
    drawLocked: getSetting("draw_locked", "0") === "1"
  });
});

// 管理员批量添加参与者。
app.post("/api/admin/participants", requireAdmin, (req, res) => {
  const names = String(req.body.names || "")
    .split(/\r?\n|,/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return fail(res, "请输入至少一个参与者名字。");

  names.forEach((name) => addParticipant(name));
  ok(res);
});

// 管理员删除参与者。
app.delete("/api/admin/participants/:id", requireAdmin, (req, res) => {
  removeParticipant(req.params.id);
  ok(res);
});

// 管理员设置或取消某个字段值的全员禁抽。
app.patch("/api/admin/field-blocks", requireAdmin, (req, res) => {
  const entryId = Number(req.body.entryId);
  const fieldKey = String(req.body.fieldKey || "");
  if (!entryId || !isValidField(fieldKey)) return fail(res, "请选择要全员禁抽的字段词条。");
  setFieldBlocked(entryId, fieldKey, req.body.globallyBlocked);
  ok(res);
});

// 管理员删除一条提交。
app.delete("/api/admin/entries/:id", requireAdmin, (req, res) => {
  removeEntry(req.params.id);
  ok(res);
});

// 管理员添加单人字段禁抽。
app.post("/api/admin/restrictions", requireAdmin, (req, res) => {
  const participantId = Number(req.body.participantId);
  const entryId = Number(req.body.entryId);
  const fieldKey = String(req.body.fieldKey || "");
  if (!participantId || !entryId || !isValidField(fieldKey)) return fail(res, "请选择参与者、字段和词条。");
  addRestriction(participantId, entryId, fieldKey);
  ok(res);
});

// 管理员删除单人字段禁抽。
app.delete("/api/admin/restrictions", requireAdmin, (req, res) => {
  removeRestriction(req.body.participantId, req.body.entryId, req.body.fieldKey);
  ok(res);
});

// 管理员一键开奖。
app.post("/api/admin/draw", requireAdmin, (req, res) => {
  try {
    const count = runDraw();
    ok(res, { count });
  } catch (error) {
    fail(res, error);
  }
});

// 管理员重置开奖结果。
app.post("/api/admin/reset-draw", requireAdmin, (req, res) => {
  resetResults();
  ok(res);
});

// 导出开奖结果 CSV。
app.get("/api/admin/export.csv", requireAdmin, (req, res) => {
  const rows = store.results
    .map((result) => {
      const participant = store.participants.find((item) => item.id === result.participant_id);
      return participant
        ? {
            participant: participant.name,
            head: result.head,
            torso: result.torso,
            upper_limbs: result.upper_limbs,
            lower_limbs: result.lower_limbs,
            feature_one: result.feature_one,
            feature_two: result.feature_two,
            personality: result.personality
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.participant.localeCompare(b.participant));
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    ["participant", "head", "torso", "upper_limbs", "lower_limbs", "feature_one", "feature_two", "personality"].map(escape).join(","),
    ...rows.map((row) => Object.values(row).map(escape).join(","))
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=draw-results.csv");
  res.send(`\uFEFF${csv}`);
});

// 管理员页面路由，返回 public/admin.html。
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// 启动 HTTP 服务。
app.listen(port, () => {
  console.log(`Entry Draw Tool running at http://localhost:${port}`);
});
