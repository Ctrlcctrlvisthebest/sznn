// 封装 fetch 请求，让页面调用接口时少写重复代码。
async function request(url, options = {}) {
  // 发起请求，默认带 JSON 请求头。
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  // 后端所有接口都返回 JSON。
  const data = await res.json();
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
  const options = fields.map((field) => `
    <option value="${field.key}">${escapeHtml(field.label)}：${escapeHtml(result[field.key] || "未填写")}</option>
  `).join("");

  resultCard.innerHTML = `
    <div class="slip-head">
      <p class="eyebrow">Oracle Slip</p>
      <h3>${escapeHtml(result.participant_name)} 的灵签</h3>
      ${result.fixed ? `<p class="status-pill seal-pill">已供奉</p>` : ""}
    </div>
    <div class="result-lines">
      ${fields.map((field) => `
        <p><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(result[field.key] || "未填写")}</strong></p>
      `).join("")}
    </div>
    <div class="result-actions">
      <button id="fixResultButton" type="button" ${result.fixed ? "disabled" : ""}>供奉此签</button>
      <div class="sacrifice-box">
        <label>献祭一项 <select id="sacrificeField" ${result.fixed ? "disabled" : ""}>${options}</select></label>
        <button id="sacrificeButton" class="secondary danger" type="button" ${result.fixed ? "disabled" : ""}>献祭并重求</button>
      </div>
    </div>
  `;

  document.querySelector("#fixResultButton").addEventListener("click", fixCurrentResult);
  document.querySelector("#sacrificeButton").addEventListener("click", sacrificeCurrentField);
}

async function fixCurrentResult() {
  if (!confirm("要把这支签供奉起来吗？供奉后，签上的七项灵文会被娘娘收进签簿，之后其他人求签时不会再抽到这些对应项。")) return;
  resultMessage.textContent = "正在供奉...";
  try {
    const { result } = await request(`/api/results/${encodeURIComponent(currentResultName)}/fix`, {
      method: "POST",
      body: "{}"
    });
    renderResult(result);
    resultMessage.textContent = "此签已供奉。";
  } catch (error) {
    resultMessage.textContent = error.message;
  }
}

async function sacrificeCurrentField() {
  const fieldKey = document.querySelector("#sacrificeField").value;
  if (!confirm("确认献祭这一项并重新求签？这次重求不会再抽到被献祭的这一项，其他人仍然可以抽到。")) return;
  resultMessage.textContent = "正在重求...";
  try {
    const { result } = await request(`/api/results/${encodeURIComponent(currentResultName)}/sacrifice`, {
      method: "POST",
      body: JSON.stringify({ fieldKey })
    });
    renderResult(result);
    resultMessage.textContent = "已重求一签。";
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
