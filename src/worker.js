const STORE_KEY = "draw-tool-store";

const INITIAL_DATA = {
  nextIds: { participant: 1, entry: 1 },
  settings: { draw_locked: "0" },
  participants: [],
  entries: [],
  fieldBlocks: [],
  restrictions: [],
  results: []
};

const DRAW_FIELDS = [
  { key: "head", label: "头" },
  { key: "torso", label: "躯干" },
  { key: "upper_limbs", label: "上肢" },
  { key: "lower_limbs", label: "下肢" },
  { key: "feature_one", label: "自由特征 1" },
  { key: "feature_two", label: "自由特征 2" },
  { key: "personality", label: "性格" }
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      if (url.pathname === "/admin") {
        return env.ASSETS.fetch(new Request(new URL("/admin.html", url), request));
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error.status || 500;
      return json({ ok: false, error: error.message || String(error) }, status);
    }
  }
};

async function handleApi(request, env, url) {
  const { pathname } = url;

  if (request.method === "POST" && pathname === "/api/admin/login") {
    const body = await readJson(request);
    if (body.password !== env.ADMIN_PASSWORD) return json({ ok: false, error: "密码不正确。" }, 401);
    const cookie = await makeSessionCookie(env);
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  }

  if (request.method === "POST" && pathname === "/api/admin/logout") {
    await requireAdmin(request, env);
    return json({ ok: true }, 200, {
      "Set-Cookie": "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });
  }

  if (request.method === "GET" && pathname === "/api/state") {
    const store = await loadStore(env);
    return json({
      ok: true,
      drawLocked: store.settings.draw_locked === "1",
      resultCount: store.results.length
    });
  }

  if (request.method === "POST" && pathname === "/api/entries") {
    const store = await loadStore(env);
    const body = await readJson(request);
    const creatorName = String(body.creatorName || "").trim();
    if (!creatorName) return json({ ok: false, error: "提交人必填。" }, 400);
    if (store.settings.draw_locked === "1") {
      return json({ ok: false, error: "已经开奖，不能继续提交词条。" }, 400);
    }

    const fields = {
      head: String(body.head || "").trim(),
      torso: String(body.torso || "").trim(),
      upperLimbs: String(body.upperLimbs || "").trim(),
      lowerLimbs: String(body.lowerLimbs || "").trim(),
      featureOne: String(body.featureOne || "").trim(),
      featureTwo: String(body.featureTwo || "").trim(),
      personality: String(body.personality || "").trim()
    };

    if (Object.values(fields).some((value) => !value)) {
      return json({ ok: false, error: "请填写完整的头、躯干、上肢、下肢、两个自由特征和性格。" }, 400);
    }

    const entry = addEntry(store, { creatorName, ...fields });
    await saveStore(env, store);
    return json({ ok: true, id: entry.id });
  }

  const resultMatch = pathname.match(/^\/api\/results\/(.+)$/);
  if (request.method === "GET" && resultMatch) {
    const store = await loadStore(env);
    const name = decodeURIComponent(resultMatch[1]).trim();
    const participant = store.participants.find((item) => item.name === name);
    const result = participant && store.results.find((item) => item.participant_id === participant.id);
    const row = result ? { participant_name: participant.name, title: `${participant.name} 的随机组合`, ...result } : null;
    if (!row) return json({ ok: false, error: "没有找到结果。请确认名字完全一致，或等待管理员开奖。" }, 404);
    return json({ ok: true, result: row });
  }

  if (pathname.startsWith("/api/admin/")) {
    await requireAdmin(request, env);
  }

  if (request.method === "GET" && pathname === "/api/admin/overview") {
    const store = await loadStore(env);
    return json({ ok: true, ...buildOverview(store) });
  }

  if (request.method === "POST" && pathname === "/api/admin/participants") {
    const store = await loadStore(env);
    const body = await readJson(request);
    const names = String(body.names || "")
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return json({ ok: false, error: "请输入至少一个参与者名字。" }, 400);
    names.forEach((name) => addParticipant(store, name));
    await saveStore(env, store);
    return json({ ok: true });
  }

  const participantDeleteMatch = pathname.match(/^\/api\/admin\/participants\/(\d+)$/);
  if (request.method === "DELETE" && participantDeleteMatch) {
    const store = await loadStore(env);
    removeParticipant(store, Number(participantDeleteMatch[1]));
    await saveStore(env, store);
    return json({ ok: true });
  }

  if (request.method === "PATCH" && pathname === "/api/admin/field-blocks") {
    const store = await loadStore(env);
    const body = await readJson(request);
    const entryId = Number(body.entryId);
    const fieldKey = String(body.fieldKey || "");
    if (!entryId || !isValidField(fieldKey)) {
      return json({ ok: false, error: "请选择要全员禁抽的字段词条。" }, 400);
    }
    setFieldBlocked(store, entryId, fieldKey, body.globallyBlocked);
    await saveStore(env, store);
    return json({ ok: true });
  }

  const entryDeleteMatch = pathname.match(/^\/api\/admin\/entries\/(\d+)$/);
  if (request.method === "DELETE" && entryDeleteMatch) {
    const store = await loadStore(env);
    removeEntry(store, Number(entryDeleteMatch[1]));
    await saveStore(env, store);
    return json({ ok: true });
  }

  if (request.method === "POST" && pathname === "/api/admin/restrictions") {
    const store = await loadStore(env);
    const body = await readJson(request);
    const participantId = Number(body.participantId);
    const entryId = Number(body.entryId);
    const fieldKey = String(body.fieldKey || "");
    if (!participantId || !entryId || !isValidField(fieldKey)) {
      return json({ ok: false, error: "请选择参与者、字段和词条。" }, 400);
    }
    addRestriction(store, participantId, entryId, fieldKey);
    await saveStore(env, store);
    return json({ ok: true });
  }

  if (request.method === "DELETE" && pathname === "/api/admin/restrictions") {
    const store = await loadStore(env);
    const body = await readJson(request);
    removeRestriction(store, body.participantId, body.entryId, body.fieldKey);
    await saveStore(env, store);
    return json({ ok: true });
  }

  if (request.method === "POST" && pathname === "/api/admin/draw") {
    const store = await loadStore(env);
    const count = runDraw(store);
    await saveStore(env, store);
    return json({ ok: true, count });
  }

  if (request.method === "POST" && pathname === "/api/admin/reset-draw") {
    const store = await loadStore(env);
    store.results = [];
    store.settings.draw_locked = "0";
    await saveStore(env, store);
    return json({ ok: true });
  }

  if (request.method === "GET" && pathname === "/api/admin/export.csv") {
    const store = await loadStore(env);
    return csvResponse(exportCsv(store));
  }

  return json({ ok: false, error: "Not found" }, 404);
}

async function loadStore(env) {
  const raw = await env.DATA.get(STORE_KEY);
  if (!raw) return structuredClone(INITIAL_DATA);
  const store = { ...structuredClone(INITIAL_DATA), ...JSON.parse(raw) };
  store.restrictions = store.restrictions.map((restriction) => ({
    ...restriction,
    field_key: restriction.field_key || "all"
  }));
  return store;
}

async function saveStore(env, store) {
  await env.DATA.put(STORE_KEY, JSON.stringify(store));
}

function addParticipant(store, name) {
  if (store.participants.some((participant) => participant.name === name)) return null;
  const participant = { id: store.nextIds.participant++, name, created_at: new Date().toISOString() };
  store.participants.push(participant);
  return participant;
}

function addEntry(store, input) {
  const id = store.nextIds.entry++;
  const entry = {
    id,
    title: `${input.creatorName} 的词条 #${id}`,
    creator_name: input.creatorName,
    head: input.head || "",
    torso: input.torso || "",
    upper_limbs: input.upperLimbs || "",
    lower_limbs: input.lowerLimbs || "",
    feature_one: input.featureOne || "",
    feature_two: input.featureTwo || "",
    personality: input.personality || "",
    globally_blocked: 0,
    created_at: new Date().toISOString()
  };
  store.entries.push(entry);
  return entry;
}

function removeParticipant(store, participantId) {
  store.participants = store.participants.filter((participant) => participant.id !== participantId);
  store.restrictions = store.restrictions.filter((restriction) => restriction.participant_id !== participantId);
  store.results = store.results.filter((result) => result.participant_id !== participantId);
}

function removeEntry(store, entryId) {
  store.entries = store.entries.filter((entry) => entry.id !== entryId);
  store.restrictions = store.restrictions.filter((restriction) => restriction.entry_id !== entryId);
  store.fieldBlocks = store.fieldBlocks.filter((block) => block.entry_id !== entryId);
}

function setFieldBlocked(store, entryId, fieldKey, blocked) {
  store.fieldBlocks = store.fieldBlocks.filter(
    (item) => item.entry_id !== entryId || item.field_key !== fieldKey
  );
  if (blocked) {
    store.fieldBlocks.push({ entry_id: entryId, field_key: fieldKey, created_at: new Date().toISOString() });
  }
}

function addRestriction(store, participantId, entryId, fieldKey) {
  const exists = store.restrictions.some(
    (item) => item.participant_id === participantId && item.entry_id === entryId && item.field_key === fieldKey
  );
  if (!exists) {
    store.restrictions.push({ participant_id: participantId, entry_id: entryId, field_key: fieldKey, created_at: new Date().toISOString() });
  }
}

function removeRestriction(store, participantId, entryId, fieldKey) {
  store.restrictions = store.restrictions.filter(
    (item) =>
      item.participant_id !== Number(participantId) ||
      item.entry_id !== Number(entryId) ||
      item.field_key !== String(fieldKey)
  );
}

function runDraw(store) {
  if (store.settings.draw_locked === "1") throw new Error("已经开奖。如需重新开奖，请先重置结果。");
  const participants = [...store.participants].sort((a, b) => a.name.localeCompare(b.name));
  const entries = [...store.entries];
  if (participants.length === 0) throw new Error("还没有参与者。");
  if (entries.length === 0) throw new Error("还没有可抽提交。");

  const fieldAssignments = new Map(
    DRAW_FIELDS.map((field) => [field.key, assignField(store, participants, entries, field)])
  );

  store.results = participants.map((participant) => {
    const result = { participant_id: participant.id, created_at: new Date().toISOString(), sources: {} };
    for (const field of DRAW_FIELDS) {
      const sourceEntry = fieldAssignments.get(field.key).get(participant.id);
      result[field.key] = sourceEntry[field.key];
      result.sources[field.key] = sourceEntry.id;
    }
    return result;
  });
  store.settings.draw_locked = "1";
  return store.results.length;
}

function assignField(store, participants, entries, field) {
  const candidates = buildCandidates(store, participants, entries, field.key);
  const impossible = participants.find((participant) => candidates.get(participant.id).length === 0);
  if (impossible) throw new Error(`${impossible.name} 没有任何可抽的${field.label}。`);

  const assignments = new Map();
  for (const participant of participants) {
    const available = candidates.get(participant.id);
    assignments.set(participant.id, available[Math.floor(Math.random() * available.length)]);
  }
  return assignments;
}

function buildCandidates(store, participants, entries, fieldKey) {
  const restricted = new Set(
    store.restrictions
      .filter((row) => row.field_key === fieldKey || row.field_key === "all")
      .map((row) => `${row.participant_id}:${row.entry_id}`)
  );
  const globallyBlocked = new Set(
    store.fieldBlocks
      .filter((block) => block.field_key === fieldKey || block.field_key === "all")
      .map((block) => block.entry_id)
  );

  return new Map(
    participants.map((participant) => [
      participant.id,
      shuffle(
        entries.filter(
          (entry) =>
            String(entry[fieldKey] || "").trim() &&
            !globallyBlocked.has(entry.id) &&
            !restricted.has(`${participant.id}:${entry.id}`)
        )
      )
    ])
  );
}

function buildOverview(store) {
  const participants = [...store.participants].sort((a, b) => a.name.localeCompare(b.name));
  const entries = [...store.entries].sort((a, b) => b.id - a.id);
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

  return {
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
    drawLocked: store.settings.draw_locked === "1"
  };
}

function exportCsv(store) {
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
  return [
    ["participant", "head", "torso", "upper_limbs", "lower_limbs", "feature_one", "feature_two", "personality"].map(escape).join(","),
    ...rows.map((row) => Object.values(row).map(escape).join(","))
  ].join("\n");
}

async function readJson(request) {
  if (!request.body) return {};
  return request.json();
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getFieldLabel(fieldKey) {
  return DRAW_FIELDS.find((field) => field.key === fieldKey)?.label || fieldKey;
}

function isValidField(fieldKey) {
  return DRAW_FIELDS.some((field) => field.key === fieldKey);
}

async function makeSessionCookie(env) {
  const issuedAt = Date.now();
  const payload = String(issuedAt);
  const signature = await sign(payload, env.SESSION_SECRET || "dev-session-secret");
  return `admin_session=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`;
}

async function requireAdmin(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const session = cookies.admin_session || "";
  const [payload, signature] = session.split(".");
  if (!payload || !signature) throw new HttpError("需要管理员登录。", 401);
  const expected = await sign(payload, env.SESSION_SECRET || "dev-session-secret");
  const ageMs = Date.now() - Number(payload);
  if (signature !== expected || !Number.isFinite(ageMs) || ageMs > 1000 * 60 * 60 * 24 * 30) {
    throw new HttpError("需要管理员登录。", 401);
  }
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function csvResponse(csv) {
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=draw-results.csv"
    }
  });
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
