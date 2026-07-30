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

// 监听词条提交。
entryForm.addEventListener("submit", async (event) => {
  // 阻止浏览器默认刷新页面。
  event.preventDefault();
  // 先显示处理中。
  entryMessage.textContent = "正在提交...";
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
    entryMessage.textContent = "提交成功。";
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
  resultMessage.textContent = "正在查询...";
  // 隐藏旧结果。
  resultCard.classList.add("hidden");
  // 读取参与者名字。
  const name = new FormData(resultForm).get("name").trim();
  // 调用结果查询接口。
  try {
    const { result } = await request(`/api/results/${encodeURIComponent(name)}`);
    // 把开奖结果写成 HTML。
    resultCard.innerHTML = `
      <h3>${escapeHtml(result.title)}</h3>
      <p>头：${escapeHtml(result.head || "未填写")}</p>
      <p>躯干：${escapeHtml(result.torso || "未填写")}</p>
      <p>上肢：${escapeHtml(result.upper_limbs || "未填写")}</p>
      <p>下肢：${escapeHtml(result.lower_limbs || "未填写")}</p>
      <p>自由特征 1：${escapeHtml(result.feature_one || "未填写")}</p>
      <p>自由特征 2：${escapeHtml(result.feature_two || "未填写")}</p>
      <p>性格：${escapeHtml(result.personality || "未填写")}</p>
    `;
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
