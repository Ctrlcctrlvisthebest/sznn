// 封装 fetch 请求，让页面调用接口时少写重复代码。
async function request(url, options = {}) {
  // 发起请求，默认带 JSON 请求头。
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await res.json()
    : { error: (await res.text()).trim() || "服务器返回了无法识别的响应" };
  // HTTP 状态不是 2xx 时，把后端错误抛给页面显示。
  if (!res.ok) throw new Error(data.error || "请求失败");
  // 成功时返回解析后的数据。
  return data;
}

// 提交词条的表单。
const entryForm = document.querySelector("#entryForm");
// 提交词条后的提示区域。
const entryMessage = document.querySelector("#entryMessage");
// 查询结果的表单。
const resultForm = document.querySelector("#resultForm");
// 查询结果后的提示区域。
const resultMessage = document.querySelector("#resultMessage");
// 展示开奖结果的卡片。
const resultCard = document.querySelector("#resultCard");
let currentResultName = "";

async function loadPublicPhase() {
  try {
    const publicState = await request("/api/state");
    const statusText = document.querySelector("#oracleStatusText");
    if (publicState.phase === "second_drawn") {
      statusText.textContent = "第二轮抽取结束";
    } else if (publicState.phase === "sacrifice_open") {
      statusText.textContent = "第二轮献祭中";
    } else {
      statusText.textContent = "由此揭签";
    }
  } catch (_) {
    // 状态读取失败时保留页面默认文字。
  }
}

loadPublicPhase();

// 监听词条提交。
entryForm.addEventListener("submit", async (event) => {
  // 阻止浏览器默认刷新页面。
  event.preventDefault();
  // 先显示处理中。
    entryMessage.textContent = "正在投签...";
  // 把表单内容读成 FormData。
  const form = new FormData(entryForm);
  // 调用后端提交接口。
  try {
    await request("/api/entries", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    // 成功后清空表单。
    entryForm.reset();
    // 显示成功提示。
    entryMessage.textContent = "签文已入筒。";
  // 捕获后端校验错误或网络错误。
  } catch (error) {
    // 把错误显示给用户。
    entryMessage.textContent = error.message;
  }
});

// 监听结果查询。
resultForm.addEventListener("submit", async (event) => {
  // 阻止默认刷新。
  event.preventDefault();
  // 先显示查询中。
  resultMessage.textContent = "正在求签...";
  // 隐藏旧结果。
  resultCard.classList.add("hidden");
  // 读取参与者名字。
  const name = new FormData(resultForm).get("name").trim();
  // 调用结果查询接口。
  try {
    const { result } = await request(`/api/results/${encodeURIComponent(name)}`);
    currentResultName = name;
    renderResult(result);
    // 显示结果卡片。
    resultCard.classList.remove("hidden");
    // 清空提示。
    resultMessage.textContent = "";
  // 捕获查询失败。
  } catch (error) {
    // 显示错误，比如还没开奖或名字不一致。
    resultMessage.textContent = error.message;
  }
});

function renderResult(result) {
  const fields = result.fields || [
    { key: "head", label: "头" },
    { key: "torso", label: "躯干" },
    { key: "upper_limbs", label: "上肢" },
    { key: "lower_limbs", label: "下肢" },
    { key: "feature_one", label: "自由特征 1" },
    { key: "feature_two", label: "自由特征 2" },
    { key: "personality", label: "性格" }
  ];
  const eligibleFields = fields.filter((field) => (
    result.sources?.[field.key]
    && !["无", "普通人类", "待重抽"].includes(result[field.key])
  ));
  const pending = result.pending_sacrifices || [];
  const ritualFailures = result.ritual_failures || [];
  const previousSlip = result.has_second_slip && !pending.length ? result.previous_slip : null;
  const secondSlip = previousSlip ? result.second_slip : result;
  const renderSlipFields = (slip) => fields.map((field) => `
    <p><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(slip?.[field.key] || "无")}</strong></p>
  `).join("");
  const sacrificePanel = result.fixed
    ? `<p class="muted">此签已供奉，所有部位均已固定。</p>`
    : result.sacrifice_open
    ? pending.length
      ? `<p class="message">已献祭 ${pending.length} 项，等待管理员统一抽取。</p>`
      : `
        <div class="sacrifice-box multi-sacrifice">
          <fieldset>
            <legend>选择要献祭的部位（至少一项）</legend>
            ${eligibleFields.map((field) => `
              <label class="check-field">
                <input type="checkbox" name="sacrificeField" value="${field.key}" />
                <span>${escapeHtml(field.label)}：${escapeHtml(result[field.key])}</span>
              </label>
            `).join("") || `<p class="muted">没有可献祭的部位。</p>`}
          </fieldset>
          <button id="sacrificeButton" class="secondary danger" type="button" ${eligibleFields.length ? "" : "disabled"}>提交献祭</button>
        </div>
      `
    : `<p class="muted">第二轮献祭尚未开启；未献祭的部位会保持固定。</p>`;
  const sideQuestPanel = !result.fixed && result.side_quest_unlocked && !result.side_quest_used
    ? `
      <div class="side-quest-box">
        <label>支线：选择一个词条化为“普通人类”
          <select id="sideQuestField">
            ${eligibleFields.map((field) => `<option value="${field.key}">${escapeHtml(field.label)}：${escapeHtml(result[field.key])}</option>`).join("")}
          </select>
        </label>
        <button id="sideQuestButton" type="button" ${eligibleFields.length ? "" : "disabled"}>化为普通人类</button>
      </div>
    ` : "";

  resultCard.innerHTML = `
    <div class="slip-head">
      <p class="eyebrow">Oracle Slip</p>
      <h3>${escapeHtml(result.participant_name)} 的灵签</h3>
      ${result.fixed ? `<p class="status-pill seal-pill">已供奉</p>` : pending.length ? `<p class="status-pill">等待重抽</p>` : ""}
    </div>
    ${ritualFailures.length ? `<div class="ritual-failure"><strong>献祭仪式人数不足，献祭失败</strong><small>以下部位的献祭词条未返还，现为“无”：${ritualFailures.map((key) => escapeHtml(fields.find((field) => field.key === key)?.label || key)).join("、")}</small></div>` : ""}
    <div class="slip-versions ${previousSlip ? "has-two-slips" : ""}">
      ${previousSlip ? `
        <section class="slip-version">
          <h4>第一张签</h4>
          <div class="result-lines">${renderSlipFields(previousSlip)}</div>
        </section>
      ` : ""}
      <section class="slip-version">
        ${previousSlip ? `<h4>第二张签</h4>` : ""}
        <div class="result-lines">${renderSlipFields(secondSlip)}</div>
      </section>
    </div>
    <div class="result-actions">
      <button id="fixResultButton" type="button" ${result.fixed || pending.length ? "disabled" : ""}>${result.fixed ? "此签已供奉" : "供奉此签（固定所有特征）"}</button>
      ${sideQuestPanel}
      ${sacrificePanel}
    </div>
  `;

  document.querySelector("#sacrificeButton")?.addEventListener("click", sacrificeCurrentFields);
  document.querySelector("#sideQuestButton")?.addEventListener("click", useSideQuest);
  document.querySelector("#fixResultButton")?.addEventListener("click", fixCurrentResult);
}

async function refreshCurrentResult() {
  const { result } = await request(`/api/results/${encodeURIComponent(currentResultName)}`);
  renderResult(result);
}

async function fixCurrentResult() {
  if (!confirm("确认供奉整支签？供奉后所有特征都会固定，不能再献祭、支线删除或参与打架。")) return;
  resultMessage.textContent = "正在供奉...";
  try {
    await request(`/api/results/${encodeURIComponent(currentResultName)}/fix`, {
      method: "POST",
      body: "{}"
    });
    await refreshCurrentResult();
    resultMessage.textContent = "此签已供奉，所有特征均已固定。";
  } catch (error) {
    resultMessage.textContent = error.message;
  }
}

async function sacrificeCurrentFields() {
  const fieldKeys = [...document.querySelectorAll("[name='sacrificeField']:checked")].map((input) => input.value);
  if (!fieldKeys.length) {
    resultMessage.textContent = "请至少选择一个要献祭的部位。";
    return;
  }
  if (!confirm(`确认献祭选中的 ${fieldKeys.length} 个部位？提交后不能修改，并等待管理员统一抽取。`)) return;
  resultMessage.textContent = "正在提交献祭...";
  try {
    await request(`/api/results/${encodeURIComponent(currentResultName)}/sacrifice`, {
      method: "POST",
      body: JSON.stringify({ fieldKeys })
    });
    await refreshCurrentResult();
    resultMessage.textContent = "献祭已提交，等待管理员统一抽取。";
  } catch (error) {
    resultMessage.textContent = error.message;
  }
}

async function useSideQuest() {
  const fieldKey = document.querySelector("#sideQuestField").value;
  if (!confirm("确认删除这个词条并变成“普通人类”？该操作每人只能使用一次，原词条会进入第二轮池。")) return;
  resultMessage.textContent = "正在完成支线...";
  try {
    await request(`/api/results/${encodeURIComponent(currentResultName)}/side-quest`, {
      method: "POST",
      body: JSON.stringify({ fieldKey })
    });
    await refreshCurrentResult();
    resultMessage.textContent = "支线已完成，该部位已变成“普通人类”。";
  } catch (error) {
    resultMessage.textContent = error.message;
  }
}

// 转义用户输入，避免把提交内容当成 HTML 执行。
function escapeHtml(value) {
  // 替换 HTML 中有特殊意义的字符。
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
