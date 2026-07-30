// 从数据层取出设置读取、保存和全局数据对象。
import { getSetting, save, store } from "./db.js";

// 所有会参与随机组合的字段；key 对应数据里的字段名，label 给界面和错误提示使用。
const DRAW_FIELDS = [
  // 头。
  { key: "head", label: "头" },
  // 躯干。
  { key: "torso", label: "躯干" },
  // 上肢。
  { key: "upper_limbs", label: "上肢" },
  // 下肢。
  { key: "lower_limbs", label: "下肢" },
  // 第一个自由特征。
  { key: "feature_one", label: "自由特征 1" },
  // 第二个自由特征。
  { key: "feature_two", label: "自由特征 2" },
  // 性格。
  { key: "personality", label: "性格" }
];

// Fisher-Yates 洗牌，用来把候选池打乱。
function shuffle(items) {
  // 复制数组，避免修改原数组。
  const arr = [...items];
  // 从后往前随机交换元素。
  for (let i = arr.length - 1; i > 0; i -= 1) {
    // 生成 0 到 i 之间的随机下标。
    const j = Math.floor(Math.random() * (i + 1));
    // 交换当前位置和随机位置。
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // 返回打乱后的新数组。
  return arr;
}

// 为每个参与者构建某一个字段的可抽候选池。
function buildCandidates(participants, entries, restrictions, fieldKey) {
  // 单人禁抽集合，只收集当前字段的规则。
  const restricted = new Set(
    // 只看同字段规则；all 是兼容旧版整条禁抽。
    restrictions
      .filter((row) => row.field_key === fieldKey || row.field_key === "all")
      // 用 participant_id:entry_id 做成快速查询 key。
      .map((row) => `${row.participant_id}:${row.entry_id}`)
  );
  // 全员禁抽集合，只收集当前字段的规则。
  const globallyBlocked = new Set(
    // 只看同字段规则；all 是兼容旧版整条禁抽。
    store.fieldBlocks
      .filter((block) => block.field_key === fieldKey || block.field_key === "all")
      // 记录被全员禁抽的提交 ID。
      .map((block) => block.entry_id)
  );

  // 返回一个 Map：参与者 ID -> 这个参与者可抽的提交列表。
  return new Map(
    // 每个参与者都单独计算候选池，因为单人禁抽不同。
    participants.map((participant) => [
      // Map 的 key 是参与者 ID。
      participant.id,
      // 候选池打乱，后续随机取时更均匀。
      shuffle(
        // 从所有提交中筛出当前字段可用的值。
        entries.filter(
          (entry) =>
            // 字段本身不能为空。
            String(entry[fieldKey] || "").trim() &&
            // 不能是全员禁抽的字段值。
            !globallyBlocked.has(entry.id) &&
            // 不能是这个参与者单人禁抽的字段值。
            !restricted.has(`${participant.id}:${entry.id}`)
        )
      )
    ])
  );
}

// 给所有参与者分配某一个字段。
function assignField(participants, entries, restrictions, field) {
  // 先计算这个字段下每个人能抽哪些值。
  const candidates = buildCandidates(participants, entries, restrictions, field.key);
  // 找出有没有完全没有候选值的人。
  const impossible = participants.find((participant) => candidates.get(participant.id).length === 0);
  // 如果某人被限制到没东西可抽，就直接报错，提示管理员调整规则。
  if (impossible) throw new Error(`${impossible.name} 没有任何可抽的${field.label}。`);

  // 保存本字段的分配结果：参与者 ID -> 来源提交。
  const assignments = new Map();
  // 每个人独立随机抽一个；同一个字段值允许被多人抽到。
  for (const participant of participants) {
    // 取出这个人的候选池。
    const available = candidates.get(participant.id);
    // 随机挑一个来源提交。
    assignments.set(participant.id, available[Math.floor(Math.random() * available.length)]);
  }
  // 返回本字段的分配结果。
  return assignments;
}

// 执行一次完整开奖。
export function runDraw() {
  // 如果已经开奖，要求管理员先重置，避免误覆盖结果。
  if (getSetting("draw_locked", "0") === "1") {
    // 抛错会被接口层转换成中文错误响应。
    throw new Error("已经开奖。如需重新开奖，请先重置结果。");
  }

  // 复制参与者列表并按名字排序，让结果顺序稳定。
  const participants = [...store.participants].sort((a, b) => a.name.localeCompare(b.name));
  // 复制提交列表；每个字段会从这些提交里各自抽。
  const entries = [...store.entries];
  // 取出当前的单人禁抽规则。
  const restrictions = store.restrictions;

  // 没有参与者时不能开奖。
  if (participants.length === 0) throw new Error("还没有参与者。");
  // 没有任何提交时不能开奖。
  if (entries.length === 0) throw new Error("还没有可抽提交。");

  // 对每个字段分别开奖，得到 fieldKey -> assignments 的映射。
  const fieldAssignments = new Map(
    // 每个字段独立随机，所以组合会被打散。
    DRAW_FIELDS.map((field) => [field.key, assignField(participants, entries, restrictions, field)])
  );

  // 生成最终结果数组，每个参与者一条结果。
  store.results = participants.map((participant) => {
    // 先准备结果基础字段。
    const result = {
      // 结果属于哪个参与者。
      participant_id: participant.id,
      // 开奖时间。
      created_at: new Date().toISOString(),
      // sources 记录每个字段来自哪条提交，方便以后排查。
      sources: {}
    };

    // 把每个字段的抽取结果写进这个参与者的最终组合里。
    for (const field of DRAW_FIELDS) {
      // 找到这个字段给当前参与者抽到的来源提交。
      const sourceEntry = fieldAssignments.get(field.key).get(participant.id);
      // 保存字段文本，例如 result.head = "灰短发"。
      result[field.key] = sourceEntry[field.key];
      // 保存来源提交 ID，例如 result.sources.head = 3。
      result.sources[field.key] = sourceEntry.id;
    }

    // 返回这个参与者的完整随机组合。
    return result;
  });

  // 标记为已开奖。
  store.settings.draw_locked = "1";
  // 保存结果到磁盘。
  save();
  // 返回本次生成了多少条结果。
  return store.results.length;
}
