// 封装后台 fetch 请求。
async function request(url, options = {}) {
  // 发起请求，默认使用 JSON。
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await res.json()
    : { error: (await res.text()).trim() || "服务器返回了无法识别的响应" };
  // 非 2xx 时抛出错误，方便统一显示。
  if (!res.ok) throw new Error(data.error || "请求失败");
  // 返回响应数据。
  return data;
}

// 登录表单。
const loginForm = document.querySelector("#loginForm");
// 管理后台主体区域。
const adminApp = document.querySelector("#adminApp");
// 登录提示。
const loginMessage = document.querySelector("#loginMessage");
// 后台操作提示。
const adminMessage = document.querySelector("#adminMessage");
// 后台当前状态缓存，loadAdmin 会刷新它。
let state = null;

// 管理员登录。
loginForm.addEventListener("submit", async (event) => {
  // 阻止默认提交。
  event.preventDefault();
  // 显示登录中。
  loginMessage.textContent = "正在登录...";
  // 调用登录接口。
  try {
    await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries()))
    });
    loginForm.classList.add("hidden");
    adminApp.classList.remove("hidden");
    await loadAdmin();
  // 登录失败时显示错误。
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

// 批量添加参与者。
document.querySelector("#participantForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await adminAction(async () => {
    await request("/api/admin/participants", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries()))
    });
    event.target.reset();
  }, "参与者已更新。");
});

// 添加单人字段禁抽。
document.querySelector("#restrictionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await adminAction(async () => {
    await request("/api/admin/restrictions", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries()))
    });
  }, "限制已添加。");
});

// 字段下拉变化时，更新“不能抽到的单项”下拉。
document.querySelector("[name='fieldKey']").addEventListener("change", renderRestrictionEntryOptions);

// 一键开奖按钮。
document.querySelector("#drawButton").addEventListener("click", async () => {
  if (!confirm("确认进行第一次统一抽取？每个部位的词条都不会重复，抽取后将停止提交。")) return;
  await adminAction(async () => request("/api/admin/draw", { method: "POST", body: "{}" }), "第一次抽取完成。");
});

document.querySelector("#openSacrificeButton").addEventListener("click", async () => {
  if (!confirm("确认开启新一轮献祭？参与者至少选择一个可用部位，提交后等待管理员统一抽取。")) return;
  await adminAction(
    async () => request("/api/admin/sacrifice-round/open", { method: "POST", body: "{}" }),
    "献祭阶段已开启。"
  );
});

document.querySelector("#secondDrawButton").addEventListener("click", async () => {
  if (!confirm("确认使用第二轮池为所有已提交献祭的参与者统一抽取？")) return;
  await adminAction(
    async () => request("/api/admin/second-draw", { method: "POST", body: "{}" }),
    "第二次统一抽取完成。"
  );
});

document.querySelector("#fightForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  const field = state.fields.find((item) => item.key === data.fieldKey);
  if (!confirm(`确认 ${data.winnerName} 抢走 ${data.loserName} 的${field?.label}？败者该部位将变成“无”，胜者原词条进入第二轮池。`)) return;
  await adminAction(async () => request("/api/admin/fight", {
    method: "POST",
    body: JSON.stringify(data)
  }), "打架结果已记录。");
});

// 重置开奖结果按钮。
document.querySelector("#resetButton").addEventListener("click", async () => {
  if (!confirm("确认重置开奖结果？这不会删除参与者、词条或限制。")) return;
  await adminAction(async () => request("/api/admin/reset-draw", { method: "POST", body: "{}" }), "开奖结果已重置。");
});

// 从后端刷新后台全部数据。
async function loadAdmin() {
  state = await request("/api/admin/overview");
  render();
}

// 后台操作统一包装：先执行操作，再刷新数据，再显示提示。
async function adminAction(action, message) {
  adminMessage.textContent = "处理中...";
  try {
    await action();
    await loadAdmin();
    adminMessage.textContent = message;
  } catch (error) {
    adminMessage.textContent = error.message;
  }
}

// 总渲染入口。
function render() {
  document.querySelector("#participantCount").textContent = `${state.participants.length} 人`;
  document.querySelector("#entryCount").textContent = `${state.entries.length} 个`;
  const phaseLabels = {
    submission: "等待第一次抽取",
    first_drawn: "第一次抽取完成",
    sacrifice_open: `第 ${state.secondRound} 轮献祭中`,
    second_drawn: `第 ${state.secondRound} 轮抽取完成`
  };
  document.querySelector("#drawStatus").textContent = phaseLabels[state.phase] || state.phase;
  document.querySelector("#drawButton").disabled = state.drawLocked;
  document.querySelector("#openSacrificeButton").disabled = !state.drawLocked || state.sacrificeOpen;
  document.querySelector("#secondDrawButton").disabled = !state.sacrificeOpen;
  document.querySelector("#poolCount").textContent = `${state.secondPool.length} 可抽`;

  renderParticipants();
  renderEntries();
  renderRestrictionForm();
  renderRestrictions();
  renderResults();
  renderFightForm();
  renderSideQuests();
  renderSecondPool();
}

// 渲染参与者列表。
function renderParticipants() {
  const wrap = document.querySelector("#participants");
  wrap.innerHTML = state.participants.map((participant) => `
    <div class="row">
      <span>${escapeHtml(participant.name)}</span>
      <button class="icon-button" data-delete-participant="${participant.id}" type="button">删除</button>
    </div>
  `).join("") || `<p class="muted">还没有参与者。</p>`;

  wrap.querySelectorAll("[data-delete-participant]").forEach((button) => {
    button.addEventListener("click", async () => {
      await adminAction(
        async () => request(`/api/admin/participants/${button.dataset.deleteParticipant}`, { method: "DELETE" }),
        "参与者已删除。"
      );
    });
  });
}

// 渲染提交词条列表和每个字段的全员禁抽按钮。
function renderEntries() {
  const wrap = document.querySelector("#entries");
  wrap.innerHTML = state.entries.map((entry) => `
    <div class="entry-row">
      <div>
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(entry.creator_name)}</p>
        <div class="field-list">
          ${state.fields.map((field) => {
            const blocked = isFieldBlocked(entry.id, field.key);
            const manualBlocked = isManuallyFieldBlocked(entry.id, field.key);
            const fixedBlocked = isFixedFieldBlocked(entry.id, field.key);
            const buttonText = fixedBlocked && !manualBlocked ? "固定中" : manualBlocked ? "恢复" : "全员禁抽";
            return `
              <div class="field-line ${blocked ? "blocked" : ""}">
                <span><strong>${escapeHtml(field.label)}</strong>：${escapeHtml(entry[field.key] || "未填")}</span>
                <button data-toggle-field="${entry.id}:${field.key}" type="button" ${fixedBlocked && !manualBlocked ? "disabled" : ""}>${buttonText}</button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <div class="mini-actions">
        <button class="danger" data-delete-entry="${entry.id}" type="button">删除</button>
      </div>
    </div>
  `).join("") || `<p class="muted">还没有词条。</p>`;

  wrap.querySelectorAll("[data-toggle-field]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [entryId, fieldKey] = button.dataset.toggleField.split(":");
      await adminAction(async () => request("/api/admin/field-blocks", {
        method: "PATCH",
        body: JSON.stringify({ entryId, fieldKey, globallyBlocked: !isManuallyFieldBlocked(Number(entryId), fieldKey) })
      }), "字段禁抽状态已更新。");
    });
  });

  wrap.querySelectorAll("[data-delete-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      await adminAction(
        async () => request(`/api/admin/entries/${button.dataset.deleteEntry}`, { method: "DELETE" }),
        "词条已删除。"
      );
    });
  });
}

// 渲染单人限制表单的参与者和字段下拉。
function renderRestrictionForm() {
  const participantSelect = document.querySelector("[name='participantId']");
  const fieldSelect = document.querySelector("[name='fieldKey']");
  participantSelect.innerHTML = state.participants.map((participant) => `
    <option value="${participant.id}">${escapeHtml(participant.name)}</option>
  `).join("");
  fieldSelect.innerHTML = state.fields.map((field) => `
    <option value="${field.key}">${escapeHtml(field.label)}</option>
  `).join("");
  renderRestrictionEntryOptions();
}

// 根据当前字段，渲染对应字段值下拉。
function renderRestrictionEntryOptions() {
  if (!state) return;
  const fieldKey = document.querySelector("[name='fieldKey']").value || state.fields[0]?.key;
  const entrySelect = document.querySelector("[name='entryId']");
  entrySelect.innerHTML = state.entries.map((entry) => {
    const field = state.fields.find((item) => item.key === fieldKey);
    return `<option value="${entry.id}">${escapeHtml(field?.label || fieldKey)}：${escapeHtml(entry[fieldKey] || "未填")}（${escapeHtml(entry.creator_name)}）</option>`;
  }).join("");
}

// 渲染已有单人限制规则。
function renderRestrictions() {
  const wrap = document.querySelector("#restrictions");
  wrap.innerHTML = state.restrictions.map((restriction) => `
    <div class="row">
      <span>${escapeHtml(restriction.participant_name)} 不能抽到 ${escapeHtml(restriction.field_label)}：${escapeHtml(restriction.field_value || restriction.entry_title)}</span>
      <button data-remove-restriction="${restriction.participant_id}:${restriction.entry_id}:${restriction.field_key}" type="button">移除</button>
    </div>
  `).join("") || `<p class="muted">还没有单人限制。</p>`;

  wrap.querySelectorAll("[data-remove-restriction]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [participantId, entryId, fieldKey] = button.dataset.removeRestriction.split(":");
      await adminAction(async () => request("/api/admin/restrictions", {
        method: "DELETE",
        body: JSON.stringify({ participantId, entryId, fieldKey })
      }), "限制已移除。");
    });
  });
}

// 判断某个字段值是否已被全员禁抽。
function isFieldBlocked(entryId, fieldKey) {
  return state.fieldBlocks.some((block) => block.entry_id === Number(entryId) && block.field_key === fieldKey);
}

// 判断某个字段值是否被管理员手动全员禁抽。
function isManuallyFieldBlocked(entryId, fieldKey) {
  return state.fieldBlocks.some((block) => (
    block.entry_id === Number(entryId)
    && block.field_key === fieldKey
    && block.reason !== "fixed_result"
  ));
}

// 判断某个字段值是否因为固定结果进入了固定池。
function isFixedFieldBlocked(entryId, fieldKey) {
  return state.fieldBlocks.some((block) => (
    block.entry_id === Number(entryId)
    && block.field_key === fieldKey
    && block.reason === "fixed_result"
  ));
}

// 渲染开奖结果。
function renderResults() {
  const wrap = document.querySelector("#results");
  wrap.innerHTML = state.results.map((result) => `
    <div class="result-admin-card">
      <div class="panel-head compact-head">
        <strong>${escapeHtml(result.participant_name)}</strong>
        ${result.pending_sacrifices?.length ? `<span class="pill">待重抽 ${result.pending_sacrifices.length} 项</span>` : ""}
        ${result.ritual_failures?.length ? `<span class="pill danger">献祭失败 ${result.ritual_failures.length} 项</span>` : ""}
      </div>
      <div class="field-list">
        ${state.fields.map((field) => `<div class="field-line"><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(result[field.key] || "无")}</span></div>`).join("")}
      </div>
    </div>
  `).join("") || `<p class="muted">开奖后这里会显示结果。</p>`;
}

function renderFightForm() {
  document.querySelector("#participantNames").innerHTML = state.results.map((result) => `
    <option value="${escapeHtml(result.participant_name)}"></option>
  `).join("");
  document.querySelector("#fightForm [name='fieldKey']").innerHTML = state.fields.map((field) => `
    <option value="${field.key}">${escapeHtml(field.label)}</option>
  `).join("");
}

function renderSideQuests() {
  const wrap = document.querySelector("#sideQuests");
  wrap.innerHTML = state.participants.map((participant) => {
    const status = participant.side_quest_used ? "已完成" : participant.side_quest_unlocked ? "已解锁" : "未解锁";
    return `
      <div class="row">
        <span><strong>${escapeHtml(participant.name)}</strong> · ${status}</span>
        <button data-unlock-side-quest="${participant.id}" type="button" ${participant.side_quest_used || participant.side_quest_unlocked || !state.drawLocked ? "disabled" : ""}>解锁</button>
      </div>
    `;
  }).join("") || `<p class="muted">还没有参与者。</p>`;

  wrap.querySelectorAll("[data-unlock-side-quest]").forEach((button) => {
    button.addEventListener("click", async () => {
      const participant = state.participants.find((item) => item.id === Number(button.dataset.unlockSideQuest));
      if (!confirm(`确认为 ${participant.name} 解锁一次支线删除机会？`)) return;
      await adminAction(
        async () => request(`/api/admin/side-quest/${participant.id}/unlock`, { method: "POST", body: "{}" }),
        "支线按钮已解锁。"
      );
    });
  });
}

function renderSecondPool() {
  const wrap = document.querySelector("#secondPool");
  const activeItems = state.secondPool.map((item) => ({ ...item, status: "active" }));
  wrap.innerHTML = activeItems.map((item) => {
    const field = state.fields.find((candidate) => candidate.key === item.field_key);
    const participant = state.participants.find((candidate) => candidate.id === item.participant_id);
    const reasonLabels = { sacrifice: "献祭", side_quest: "支线删除", fight_replaced: "打架替换" };
    const statusText = "当前可抽";
    return `
      <div class="row">
        <span><strong>${escapeHtml(field?.label || item.field_key)}</strong>：${escapeHtml(item.value)}</span>
        <span class="muted">${escapeHtml(statusText)} · ${escapeHtml(reasonLabels[item.reason] || item.reason)}${participant ? ` · 来源 ${escapeHtml(participant.name)}` : ""}</span>
      </div>
    `;
  }).join("") || `<p class="muted">第二轮抽取池目前为空。</p>`;
}

// 转义用户提交内容，避免 HTML 注入。
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

// 页面打开时尝试读取后台数据；如果 cookie 还有效，就直接进入后台。
loadAdmin().then(() => {
  loginForm.classList.add("hidden");
  adminApp.classList.remove("hidden");
}).catch(() => {});
