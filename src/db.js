// 引入 Node.js 的文件系统模块，用来读写本地 JSON 数据文件。
import fs from "node:fs";
// 引入 Node.js 的路径模块，用来安全拼接跨平台文件路径。
import path from "node:path";

// 数据目录固定放在项目根目录下的 data 文件夹。
const dataDir = path.join(process.cwd(), "data");
// 所有业务数据都存在这一个 JSON 文件里，方便一天测试时查看和备份。
const dataFile = path.join(dataDir, "store.json");
// 如果 data 文件夹不存在，就先创建它；recursive 允许父目录一起创建。
fs.mkdirSync(dataDir, { recursive: true });

// 新项目第一次启动时使用的空数据结构。
const initialData = {
  // 自增 ID，避免参与者和提交词条互相撞 ID。
  nextIds: { participant: 1, entry: 1 },
  // draw_locked 控制是否已经开奖，开奖后普通用户不能继续提交。
  settings: { draw_locked: "0" },
  // 参与者名单，管理员在后台批量添加。
  participants: [],
  // 大家提交的完整词条行，每行包含头、躯干、上肢等字段。
  entries: [],
  // 全员禁抽的单个字段值，例如某一行里的“头”。
  fieldBlocks: [],
  // 单人禁抽的单个字段值，例如 A 不能抽到某一行里的“躯干”。
  restrictions: [],
  // 开奖后保存的随机组合结果。
  results: []
};

// 从磁盘载入数据；如果没有数据文件，就返回一份全新的空结构。
function load() {
  // 首次运行时 store.json 不存在，直接用默认结构。
  if (!fs.existsSync(dataFile)) return structuredClone(initialData);
  // 读取已有 JSON 文件内容。
  const raw = fs.readFileSync(dataFile, "utf8");
  // 合并默认结构，保证以后新增字段时旧数据也能继续跑。
  const data = { ...structuredClone(initialData), ...JSON.parse(raw) };
  // 兼容旧版限制规则：旧规则没有 field_key，这里标记成 all。
  data.restrictions = data.restrictions.map((restriction) => ({
    // 保留旧限制对象里的所有字段。
    ...restriction,
    // 新限制必须知道自己针对哪个字段；旧数据默认代表整条。
    field_key: restriction.field_key || "all"
  }));
  // 返回已经修补过的数据对象。
  return data;
}

// 全局内存数据；服务启动后读一次，之后所有接口都改这份对象。
export const store = load();

// 把当前内存数据写回 data/store.json。
export function save() {
  // JSON.stringify 的第三个参数 2 让文件带缩进，方便人类阅读。
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

// 读取设置项，比如 draw_locked。
export function getSetting(key, fallback = null) {
  // 如果设置不存在，就返回调用方给的默认值。
  return store.settings[key] ?? fallback;
}

// 写入设置项，并立刻保存到磁盘。
export function setSetting(key, value) {
  // 所有设置都存成字符串，保持数据文件简单。
  store.settings[key] = String(value);
  // 每次修改后立即落盘，避免测试时误关服务丢数据。
  save();
}

// 添加一个参与者名字。
export function addParticipant(name) {
  // 同名参与者不重复添加。
  if (store.participants.some((participant) => participant.name === name)) return null;
  // 组装参与者记录。
  const participant = {
    // 使用自增 ID 做内部标识。
    id: store.nextIds.participant++,
    // 保存管理员输入的显示名。
    name,
    // 保存创建时间，方便之后排查数据。
    created_at: new Date().toISOString()
  };
  // 放入参与者数组。
  store.participants.push(participant);
  // 保存到磁盘。
  save();
  // 返回新建记录，接口可以继续使用它。
  return participant;
}

// 添加一条用户提交的完整词条。
export function addEntry(input) {
  // 先取出新的词条 ID。
  const id = store.nextIds.entry++;
  // 组装词条记录；title 是后台显示用的内部名称。
  const entry = {
    // 内部 ID。
    id,
    // 用户不再填写词条名称，所以自动生成一个可识别的名称。
    title: `${input.creatorName} 的词条 #${id}`,
    // 记录是谁提交的。
    creator_name: input.creatorName,
    // 头字段。
    head: input.head || "",
    // 躯干字段。
    torso: input.torso || "",
    // 上肢字段。
    upper_limbs: input.upperLimbs || "",
    // 下肢字段。
    lower_limbs: input.lowerLimbs || "",
    // 第一个自由特征。
    feature_one: input.featureOne || "",
    // 第二个自由特征。
    feature_two: input.featureTwo || "",
    // 性格字段。
    personality: input.personality || "",
    // 旧版整条禁抽标记，目前不再使用，保留是为了兼容旧数据。
    globally_blocked: 0,
    // 创建时间。
    created_at: new Date().toISOString()
  };
  // 放入词条数组。
  store.entries.push(entry);
  // 保存到磁盘。
  save();
  // 返回新建词条。
  return entry;
}

// 删除一个参与者，同时清理关联限制和结果。
export function removeParticipant(id) {
  // URL 传来的 id 是字符串，这里转成数字。
  const participantId = Number(id);
  // 删除参与者本身。
  store.participants = store.participants.filter((participant) => participant.id !== participantId);
  // 删除这个参与者相关的单人禁抽规则。
  store.restrictions = store.restrictions.filter((restriction) => restriction.participant_id !== participantId);
  // 删除这个参与者已有的开奖结果。
  store.results = store.results.filter((result) => result.participant_id !== participantId);
  // 保存变更。
  save();
}

// 删除一条提交，同时清理所有依赖它的规则和结果。
export function removeEntry(id) {
  // 把传入 ID 转为数字。
  const entryId = Number(id);
  // 删除提交记录。
  store.entries = store.entries.filter((entry) => entry.id !== entryId);
  // 删除针对这条提交的单人禁抽规则。
  store.restrictions = store.restrictions.filter((restriction) => restriction.entry_id !== entryId);
  // 删除针对这条提交的全员字段禁抽规则。
  store.fieldBlocks = store.fieldBlocks.filter((block) => block.entry_id !== entryId);
  // 清理旧版可能遗留的整条结果引用。
  store.results = store.results.filter((result) => result.entry_id !== entryId);
  // 保存变更。
  save();
}

// 设置或取消某个字段值的全员禁抽。
export function setFieldBlocked(entryId, fieldKey, blocked) {
  // 标准化要操作的字段禁抽对象。
  const block = {
    // 哪一条提交。
    entry_id: Number(entryId),
    // 哪一个字段，例如 head 或 torso。
    field_key: String(fieldKey)
  };
  // 先移除旧记录，避免重复。
  store.fieldBlocks = store.fieldBlocks.filter(
    // 保留不是同一个 entry+field 的记录。
    (item) => item.entry_id !== block.entry_id || item.field_key !== block.field_key
  );
  // 如果 blocked 为 true，就重新加入禁抽列表。
  if (blocked) {
    // 写入禁抽规则和创建时间。
    store.fieldBlocks.push({ ...block, created_at: new Date().toISOString() });
  }
  // 保存变更。
  save();
}

// 添加“某个参与者不能抽到某条提交里的某个字段值”的规则。
export function addRestriction(participantId, entryId, fieldKey) {
  // 组装规则对象。
  const restriction = {
    // 被限制的参与者。
    participant_id: Number(participantId),
    // 字段值来自哪条提交。
    entry_id: Number(entryId),
    // 限制的是哪个字段。
    field_key: String(fieldKey),
    // 创建时间。
    created_at: new Date().toISOString()
  };
  // 判断是否已有完全相同的规则。
  const exists = store.restrictions.some(
    (item) =>
      // 同一个参与者。
      item.participant_id === restriction.participant_id &&
      // 同一条提交。
      item.entry_id === restriction.entry_id &&
      // 同一个字段。
      item.field_key === restriction.field_key
  );
  // 不存在时才添加，避免后台重复点按钮产生重复规则。
  if (!exists) {
    // 放入限制数组。
    store.restrictions.push(restriction);
    // 保存变更。
    save();
  }
}

// 移除一条单人字段禁抽规则。
export function removeRestriction(participantId, entryId, fieldKey) {
  // 过滤掉匹配参与者、提交、字段的那条规则。
  store.restrictions = store.restrictions.filter(
    (item) =>
      // 参与者不同则保留。
      item.participant_id !== Number(participantId) ||
      // 提交不同则保留。
      item.entry_id !== Number(entryId) ||
      // 字段不同则保留。
      item.field_key !== String(fieldKey)
  );
  // 保存变更。
  save();
}

// 清空开奖结果并解锁，让管理员可以重新开奖。
export function resetResults() {
  // 删除所有结果。
  store.results = [];
  // 标记为未开奖。
  store.settings.draw_locked = "0";
  // 保存变更。
  save();
}
