// 封装后台 fetch 请求。
async function request(url, options = {}) {
  // 发起请求，默认使用 JSON。
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  // 解析后端 JSON 响应。
  const data = await res.json();
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
  if (!confirm("确认现在开奖？开奖后普通用户将不能继续提交词条。")) return;
  await adminAction(async () => request("/api/admin/draw", { method: "POST", body: "{}" }), "开奖完成。");
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
  document.querySelector("#drawStatus").textContent = state.drawLocked ? "已开奖" : "未开奖";
  document.querySelector("#drawButton").disabled = state.drawLocked;

  renderParticipants();
  renderEntries();
  renderRestrictionForm();
  renderRestrictions();
  renderResults();
  renderFixedResults();
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
    <div class="row">
      <span><strong>${escapeHtml(result.participant_name)}</strong> 的随机组合</span>
      <span class="muted">${escapeHtml(result.head || "-")} / ${escapeHtml(result.torso || "-")} / ${escapeHtml(result.personality || "-")}</span>
    </div>
  `).join("") || `<p class="muted">开奖后这里会显示结果。</p>`;
}

// 渲染管理员可修改的固定结果。
function renderFixedResults() {
  const wrap = document.querySelector("#fixedResults");
  const fixedResults = state.results.filter((result) => result.fixed);
  const unfixedResults = state.results.filter((result) => !result.fixed);
  wrap.innerHTML = `
    ${fixedResults.map(renderFixedResultCard).join("") || `<p class="muted">还没有固定结果。</p>`}
    ${unfixedResults.length ? `
      <div class="fixed-candidates">
        <h3>可加入固定池</h3>
        ${unfixedResults.map((result) => `
          <div class="row">
            <span>${escapeHtml(result.participant_name)} 的当前结果</span>
            <button data-admin-fix-result="${result.participant_id}" type="button">固定</button>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;

  wrap.querySelectorAll("[data-admin-fix-result]").forEach((button) => {
    button.addEventListener("click", async () => {
      const participantId = Number(button.dataset.adminFixResult);
      const result = findResult(participantId);
      if (!confirm(`确认固定 ${result.participant_name} 的此次结果？这些字段值会从之后的抽奖池移除。`)) return;
      await adminAction(
        async () => request(`/api/admin/fixed-results/${participantId}`, { method: "POST", body: "{}" }),
        "结果已固定。"
      );
    });
  });

  wrap.querySelectorAll("[data-unfix-result]").forEach((button) => {
    button.addEventListener("click", async () => {
      const participantId = Number(button.dataset.unfixResult);
      const result = findResult(participantId);
      if (!confirm(`确认取消固定 ${result.participant_name} 的结果？这些字段值会从固定池释放。`)) return;
      await adminAction(
        async () => request(`/api/admin/fixed-results/${participantId}`, { method: "DELETE" }),
        "固定已取消。"
      );
    });
  });

  wrap.querySelectorAll("[data-change-fixed-field]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [participantIdText, fieldKey] = button.dataset.changeFixedField.split(":");
      const participantId = Number(participantIdText);
      const select = wrap.querySelector(`[data-fixed-select="${participantId}:${fieldKey}"]`);
      const entryId = Number(select.value);
      const result = findResult(participantId);
      const field = state.fields.find((item) => item.key === fieldKey);
      const entry = findEntry(entryId);
      const currentEntryId = result.sources?.[fieldKey];
      const oldValue = result[fieldKey] || "-";
      const newValue = entry?.[fieldKey] || "-";
      if (!entryId || entryId === currentEntryId) return;
      if (!confirm(`确认把 ${result.participant_name} 的${field.label}从「${oldValue}」改成「${newValue}」？固定池会同步更新。`)) return;
      await adminAction(async () => request(`/api/admin/fixed-results/${participantId}`, {
        method: "PATCH",
        body: JSON.stringify({ fieldKey, entryId })
      }), "固定结果已更新。");
    });
  });
}

// 渲染单个固定结果卡片。
function renderFixedResultCard(result) {
  return `
    <div class="fixed-card">
      <div class="panel-head compact-head">
        <h3>${escapeHtml(result.participant_name)}</h3>
        <button class="secondary danger" data-unfix-result="${result.participant_id}" type="button">取消固定</button>
      </div>
      <div class="field-list">
        ${state.fields.map((field) => renderFixedFieldLine(result, field)).join("")}
      </div>
    </div>
  `;
}

// 渲染固定结果里的单个字段编辑行。
function renderFixedFieldLine(result, field) {
  const currentEntryId = result.sources?.[field.key];
  const options = state.entries
    .filter((entry) => String(entry[field.key] || "").trim())
    .map((entry) => `
      <option value="${entry.id}" ${entry.id === currentEntryId ? "selected" : ""}>
        ${escapeHtml(entry[field.key])}（${escapeHtml(entry.creator_name)}）
      </option>
    `).join("");
  return `
    <div class="fixed-field-line">
      <span><strong>${escapeHtml(field.label)}</strong>：${escapeHtml(result[field.key] || "-")}</span>
      <div class="fixed-field-edit">
        <select data-fixed-select="${result.participant_id}:${field.key}">${options}</select>
        <button data-change-fixed-field="${result.participant_id}:${field.key}" type="button">更换</button>
      </div>
    </div>
  `;
}

// 根据参与者 id 找到开奖结果。
function findResult(participantId) {
  return state.results.find((result) => result.participant_id === participantId);
}

// 根据词条 id 找到提交词条。
function findEntry(entryId) {
  return state.entries.find((entry) => entry.id === entryId);
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
