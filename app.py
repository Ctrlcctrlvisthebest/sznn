import csv
import hmac
import io
import json
import os
import random
import secrets
import time
from copy import deepcopy
from pathlib import Path

from flask import Flask, Response, jsonify, make_response, request, send_from_directory


STORE_PATH = Path("data/store.json")
ADMIN_COOKIE = "admin_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30

INITIAL_DATA = {
    "nextIds": {"participant": 1, "entry": 1},
    "settings": {
        "draw_locked": "0",
        "phase": "submission",
        "second_round": 0,
        "sacrifice_open": False,
    },
    "participants": [],
    "entries": [],
    "fieldBlocks": [],
    "restrictions": [],
    "results": [],
    "secondPool": [],
    "secondPoolHistory": [],
    "firstDrawUsed": [],
}

DRAW_FIELDS = [
    {"key": "head", "label": "头"},
    {"key": "torso", "label": "躯干"},
    {"key": "upper_limbs", "label": "上肢"},
    {"key": "lower_limbs", "label": "下肢"},
    {"key": "feature_one", "label": "自由特征 1"},
    {"key": "feature_two", "label": "自由特征 2"},
    {"key": "personality", "label": "性格"},
]

app = Flask(__name__, static_folder="public", static_url_path="")


def load_store():
    if not STORE_PATH.exists():
        return deepcopy(INITIAL_DATA)

    with STORE_PATH.open("r", encoding="utf-8") as file:
        store = {**deepcopy(INITIAL_DATA), **json.load(file)}

    store["restrictions"] = [
        {**restriction, "field_key": restriction.get("field_key") or "all"}
        for restriction in store["restrictions"]
    ]
    store["settings"] = {**deepcopy(INITIAL_DATA["settings"]), **store.get("settings", {})}
    if store["settings"].get("draw_locked") == "1" and store["settings"].get("phase") == "submission":
        store["settings"]["phase"] = "first_drawn"
    store.setdefault("secondPool", [])
    store.setdefault("secondPoolHistory", [])
    store.setdefault("firstDrawUsed", [])
    for participant in store["participants"]:
        participant.setdefault("side_quest_unlocked", False)
        participant.setdefault("side_quest_used", False)
    for result in store["results"]:
        result.setdefault("pending_sacrifices", [])
    return store


def save_store(store):
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with STORE_PATH.open("w", encoding="utf-8") as file:
        json.dump(store, file, ensure_ascii=False, indent=2)


def get_admin_password():
    return os.environ.get("ADMIN_PASSWORD", "admin")


def get_session_secret():
    return os.environ.get("SESSION_SECRET", "dev-session-secret")


def sign(payload):
    return hmac.new(
        get_session_secret().encode("utf-8"),
        payload.encode("utf-8"),
        "sha256",
    ).hexdigest()


def make_session_value():
    payload = f"{int(time.time())}:{secrets.token_hex(16)}"
    return f"{payload}.{sign(payload)}"


def is_admin_request():
    session = request.cookies.get(ADMIN_COOKIE, "")
    payload, separator, signature = session.rpartition(".")
    if not separator or not payload or not signature:
        return False

    timestamp_text = payload.split(":", 1)[0]
    try:
        age = time.time() - int(timestamp_text)
    except ValueError:
        return False

    return age <= SESSION_MAX_AGE and hmac.compare_digest(signature, sign(payload))


def require_admin():
    if not is_admin_request():
        return jsonify({"ok": False, "error": "需要管理员登录。"}), 401
    return None


def get_field_label(field_key):
    for field in DRAW_FIELDS:
        if field["key"] == field_key:
            return field["label"]
    return field_key


def is_valid_field(field_key):
    return any(field["key"] == field_key for field in DRAW_FIELDS)


def add_participant(store, name):
    if any(participant["name"] == name for participant in store["participants"]):
        return None

    participant = {
        "id": store["nextIds"]["participant"],
        "name": name,
        "created_at": now(),
    }
    store["nextIds"]["participant"] += 1
    store["participants"].append(participant)
    return participant


def add_entry(store, data):
    entry_id = store["nextIds"]["entry"]
    store["nextIds"]["entry"] += 1

    entry = {
        "id": entry_id,
        "title": f"{data['creatorName']} 的词条 #{entry_id}",
        "creator_name": data["creatorName"],
        "head": data.get("head", ""),
        "torso": data.get("torso", ""),
        "upper_limbs": data.get("upperLimbs", ""),
        "lower_limbs": data.get("lowerLimbs", ""),
        "feature_one": data.get("featureOne", ""),
        "feature_two": data.get("featureTwo", ""),
        "personality": data.get("personality", ""),
        "globally_blocked": 0,
        "created_at": now(),
    }
    store["entries"].append(entry)
    return entry


def creator_name_exists(store, creator_name):
    normalized_name = creator_name.strip().casefold()
    return any(
        str(entry.get("creator_name", "")).strip().casefold() == normalized_name
        for entry in store["entries"]
    )


def remove_participant(store, participant_id):
    store["participants"] = [
        participant for participant in store["participants"] if participant["id"] != participant_id
    ]
    store["restrictions"] = [
        restriction for restriction in store["restrictions"]
        if restriction["participant_id"] != participant_id
    ]
    store["results"] = [
        result for result in store["results"] if result["participant_id"] != participant_id
    ]
    store["fieldBlocks"] = [
        block for block in store["fieldBlocks"]
        if block.get("participant_id") != participant_id
    ]


def remove_entry(store, entry_id):
    store["entries"] = [entry for entry in store["entries"] if entry["id"] != entry_id]
    store["restrictions"] = [
        restriction for restriction in store["restrictions"] if restriction["entry_id"] != entry_id
    ]
    store["fieldBlocks"] = [
        block for block in store["fieldBlocks"] if block["entry_id"] != entry_id
    ]


def set_field_blocked(store, entry_id, field_key, blocked):
    store["fieldBlocks"] = [
        block for block in store["fieldBlocks"]
        if block["entry_id"] != entry_id
        or block["field_key"] != field_key
        or block.get("reason") == "fixed_result"
    ]
    if blocked:
        store["fieldBlocks"].append({
            "entry_id": entry_id,
            "field_key": field_key,
            "created_at": now(),
            "reason": "manual",
        })


def add_restriction(store, participant_id, entry_id, field_key, reason="manual"):
    exists = any(
        restriction["participant_id"] == participant_id
        and restriction["entry_id"] == entry_id
        and restriction["field_key"] == field_key
        for restriction in store["restrictions"]
    )
    if not exists:
        store["restrictions"].append({
            "participant_id": participant_id,
            "entry_id": entry_id,
            "field_key": field_key,
            "created_at": now(),
            "reason": reason,
        })


def remove_restriction(store, participant_id, entry_id, field_key):
    store["restrictions"] = [
        restriction for restriction in store["restrictions"]
        if restriction["participant_id"] != participant_id
        or restriction["entry_id"] != entry_id
        or restriction["field_key"] != field_key
    ]


def remove_sacrifice_restriction(store, participant_id, entry_id, field_key):
    store["restrictions"] = [
        restriction for restriction in store["restrictions"]
        if restriction["participant_id"] != participant_id
        or restriction["entry_id"] != entry_id
        or restriction["field_key"] != field_key
        or restriction.get("reason") != "sacrifice"
    ]


def build_candidates(store, participants, entries, field_key):
    restricted = {
        f"{restriction['participant_id']}:{restriction['entry_id']}"
        for restriction in store["restrictions"]
        if restriction["field_key"] in (field_key, "all")
    }
    globally_blocked = {
        block["entry_id"]
        for block in store["fieldBlocks"]
        if block["field_key"] in (field_key, "all")
    }

    candidates = {}
    for participant in participants:
        available = [
            entry for entry in entries
            if str(entry.get(field_key, "")).strip()
            and entry["id"] not in globally_blocked
            and f"{participant['id']}:{entry['id']}" not in restricted
        ]
        random.shuffle(available)
        candidates[participant["id"]] = available
    return candidates


def assign_field(store, participants, entries, field):
    candidates = build_candidates(store, participants, entries, field["key"])
    for participant in participants:
        if not candidates[participant["id"]]:
            raise ValueError(f"{participant['name']} 没有任何可抽的{field['label']}。")

    return {
        participant["id"]: random.choice(candidates[participant["id"]])
        for participant in participants
    }


def assign_unique_field(store, participants, entries, field, preassigned=None):
    """Assign one distinct submitted entry token per participant in the first round."""
    preassigned = preassigned or {}
    assignments = dict(preassigned)
    used_entry_ids = {entry["id"] for entry in assignments.values()}
    if len(used_entry_ids) != len(assignments):
        raise ValueError(f"{field['label']}的自有词条发生重复占用，无法完成分配。")
    remaining = [participant for participant in participants if participant["id"] not in assignments]
    candidates = build_candidates(store, remaining, entries, field["key"])
    for participant in remaining:
        candidates[participant["id"]] = [
            entry for entry in candidates[participant["id"]]
            if entry["id"] not in used_entry_ids
        ]
        random.shuffle(candidates[participant["id"]])

    entry_owner = {}

    def match_participant(participant_id, seen_entry_ids):
        for entry in candidates[participant_id]:
            entry_id = entry["id"]
            if entry_id in seen_entry_ids:
                continue
            seen_entry_ids.add(entry_id)
            current_owner = entry_owner.get(entry_id)
            if current_owner is None or match_participant(current_owner, seen_entry_ids):
                entry_owner[entry_id] = participant_id
                assignments[participant_id] = entry
                return True
        return False

    for participant in sorted(remaining, key=lambda item: len(candidates[item["id"]])):
        if not match_participant(participant["id"], set()):
            raise ValueError(
                f"{field['label']}没有足够的未使用投稿词条，请补充词条或调整禁抽限制。"
            )
    return assignments


def get_participant_entries(participant, entries):
    return [
        entry for entry in entries
        if str(entry.get("creator_name", "")).strip() == participant["name"]
    ]


def choose_self_match_slots(participants, entries):
    self_matches = {}
    for participant in participants:
        own_entries = get_participant_entries(participant, entries)
        possible_matches = [
            {"field": field, "entry": entry}
            for field in DRAW_FIELDS
            for entry in own_entries
            if str(entry.get(field["key"], "")).strip()
        ]
        if not possible_matches:
            continue

        self_matches[participant["id"]] = random.choice(possible_matches)
    return self_matches


def choose_unique_self_match_slots(store, participants, entries):
    self_matches = {}
    for participant in participants:
        allowed_by_field = {
            field["key"]: {
                entry["id"] for entry in build_candidates(
                    store, [participant], entries, field["key"]
                )[participant["id"]]
            }
            for field in DRAW_FIELDS
        }
        possible_matches = [
            {"field": field, "entry": entry}
            for field in DRAW_FIELDS
            for entry in get_participant_entries(participant, entries)
            if entry["id"] in allowed_by_field[field["key"]]
        ]
        if possible_matches:
            self_matches[participant["id"]] = random.choice(possible_matches)
    return self_matches


def get_fixed_results(store):
    return [
        result for result in store["results"]
        if result.get("fixed")
    ]


def draw_result_for_participant(store, participant):
    entries = list(store["entries"])
    if not entries:
        raise ValueError("还没有可抽提交。")

    result = {
        "participant_id": participant["id"],
        "created_at": now(),
        "sources": {},
    }
    for field in DRAW_FIELDS:
        assignment = assign_field(store, [participant], entries, field)
        source_entry = assignment[participant["id"]]
        result[field["key"]] = source_entry[field["key"]]
        result["sources"][field["key"]] = source_entry["id"]
    return result


def run_draw(store):
    if store["settings"].get("draw_locked") == "1":
        raise ValueError("已经开奖。如需重新开奖，请先重置结果。")

    participants = sorted(store["participants"], key=lambda item: item["name"])
    entries = list(store["entries"])
    if not participants:
        raise ValueError("还没有参与者。")
    if not entries:
        raise ValueError("还没有可抽提交。")

    for field in DRAW_FIELDS:
        field_candidates = build_candidates(store, participants, entries, field["key"])
        available_entry_ids = {
            entry["id"]
            for participant in participants
            for entry in field_candidates[participant["id"]]
            if str(entry.get(field["key"], "")).strip()
        }
        if len(available_entry_ids) < len(participants):
            raise ValueError(
                f"{field['label']}只有 {len(available_entry_ids)} 个可用投稿词条，但有 {len(participants)} 名参与者；"
                "请补充词条后再进行第一次抽取。"
            )

    participants_to_draw = participants
    field_assignments = None
    last_assignment_error = None
    for _ in range(50):
        self_matches = choose_unique_self_match_slots(store, participants_to_draw, entries)
        candidate_assignments = {}
        try:
            for field in DRAW_FIELDS:
                preassigned = {
                    participant["id"]: self_matches[participant["id"]]["entry"]
                    for participant in participants_to_draw
                    if self_matches.get(participant["id"], {}).get("field", {}).get("key") == field["key"]
                }
                candidate_assignments[field["key"]] = assign_unique_field(
                    store, participants_to_draw, entries, field, preassigned
                )
        except ValueError as error:
            last_assignment_error = error
            continue
        field_assignments = candidate_assignments
        break
    if field_assignments is None:
        raise last_assignment_error or ValueError("无法完成第一次不重复抽取。")

    results = []
    for participant in participants_to_draw:
        result = {
            "participant_id": participant["id"],
            "created_at": now(),
            "sources": {},
        }
        for field in DRAW_FIELDS:
            source_entry = field_assignments[field["key"]][participant["id"]]
            result[field["key"]] = source_entry[field["key"]]
            result["sources"][field["key"]] = source_entry["id"]
        results.append(result)

    store["results"] = results
    store["firstDrawUsed"] = [
        {
            "entry_id": result["sources"][field["key"]],
            "field_key": field["key"],
            "participant_id": result["participant_id"],
            "used_at": now(),
        }
        for result in results
        for field in DRAW_FIELDS
    ]
    store["settings"]["draw_locked"] = "1"
    store["settings"]["phase"] = "first_drawn"
    store["settings"]["sacrifice_open"] = False
    store["settings"]["second_round"] = 0
    store["secondPool"] = []
    return len(results)


def find_result_for_participant(store, participant_id):
    return next(
        (result for result in store["results"] if result["participant_id"] == participant_id),
        None,
    )


def fixed_result_block_exists(store, participant_id, entry_id, field_key):
    return any(
        block["entry_id"] == entry_id
        and block["field_key"] == field_key
        and block.get("reason") == "fixed_result"
        and block.get("participant_id") == participant_id
        for block in store["fieldBlocks"]
    )


def add_fixed_result_block(store, participant_id, entry_id, field_key):
    if fixed_result_block_exists(store, participant_id, entry_id, field_key):
        return
    store["fieldBlocks"].append({
        "entry_id": entry_id,
        "field_key": field_key,
        "created_at": now(),
        "reason": "fixed_result",
        "participant_id": participant_id,
    })


def remove_fixed_result_block(store, participant_id, entry_id, field_key):
    store["fieldBlocks"] = [
        block for block in store["fieldBlocks"]
        if block["entry_id"] != entry_id
        or block["field_key"] != field_key
        or block.get("reason") != "fixed_result"
        or block.get("participant_id") != participant_id
    ]


def fix_result(store, participant, result):
    sources = result.get("sources") or {}
    for field in DRAW_FIELDS:
        entry_id = sources.get(field["key"])
        if entry_id:
            add_fixed_result_block(store, participant["id"], entry_id, field["key"])
    result["fixed"] = True
    result["fixed_at"] = now()


def update_fixed_result_field(store, participant, result, field_key, entry_id):
    if not result.get("fixed"):
        raise ValueError("这个结果还没有固定，不能编辑固定数据。")
    if not is_valid_field(field_key):
        raise ValueError("请选择要修改的字段。")

    entry = find_by_id(store["entries"], entry_id)
    if not entry:
        raise ValueError("没有找到这个词条。")
    if not str(entry.get(field_key, "")).strip():
        raise ValueError("这个词条的对应字段为空，不能用于固定结果。")

    sources = result.setdefault("sources", {})
    old_entry_id = sources.get(field_key)
    if old_entry_id:
        remove_fixed_result_block(store, participant["id"], old_entry_id, field_key)

    result[field_key] = entry[field_key]
    sources[field_key] = entry["id"]
    result["updated_at"] = now()
    add_fixed_result_block(store, participant["id"], entry["id"], field_key)
    return result


def unfix_result(store, participant, result):
    if not result.get("fixed"):
        raise ValueError("这个结果还没有固定。")

    sources = result.get("sources") or {}
    for field in DRAW_FIELDS:
        entry_id = sources.get(field["key"])
        if entry_id:
            remove_fixed_result_block(store, participant["id"], entry_id, field["key"])

    result["fixed"] = False
    result.pop("fixed_at", None)
    result["updated_at"] = now()
    return result


def add_to_second_pool(store, entry_id, field_key, value, reason, participant_id=None):
    if not entry_id or not is_valid_field(field_key):
        return
    exists = any(
        item["entry_id"] == entry_id and item["field_key"] == field_key
        for item in store["secondPool"]
    )
    if exists:
        return
    store["secondPool"].append({
        "entry_id": entry_id,
        "field_key": field_key,
        "value": value,
        "reason": reason,
        "participant_id": participant_id,
        "created_at": now(),
    })


def open_sacrifice_round(store):
    if store["settings"].get("draw_locked") != "1":
        raise ValueError("请先完成第一次抽取。")
    if store["settings"].get("sacrifice_open"):
        raise ValueError("当前已经处于献祭阶段。")
    if any(result.get("pending_sacrifices") for result in store["results"]):
        raise ValueError("还有上一轮待抽取的献祭词条。")
    store["settings"]["second_round"] = int(store["settings"].get("second_round") or 0) + 1
    store["firstDrawUsed"] = []
    store["settings"]["sacrifice_open"] = True
    store["settings"]["phase"] = "sacrifice_open"


def submit_sacrifices(store, participant, result, field_keys):
    if result.get("fixed"):
        raise ValueError("这支签已经供奉，不能再献祭。")
    if not store["settings"].get("sacrifice_open"):
        raise ValueError("管理员尚未开启第二次抽取的献祭阶段。")
    if result.get("pending_sacrifices"):
        raise ValueError("你本轮已经提交过献祭。")
    field_keys = list(dict.fromkeys(field_keys))
    if not field_keys:
        raise ValueError("至少献祭一个部位词条。")
    if any(not is_valid_field(field_key) for field_key in field_keys):
        raise ValueError("献祭字段不正确。")

    sources = result.setdefault("sources", {})
    previous_slip = {
        field["key"]: result.get(field["key"], "")
        for field in DRAW_FIELDS
    }
    previous_slip["sources"] = dict(sources)
    for field_key in field_keys:
        previous_slip[field_key] = "无"
        previous_slip["sources"][field_key] = None

    for field_key in field_keys:
        source_entry_id = sources.get(field_key)
        if not source_entry_id or result.get(field_key) in ("无", "普通人类", "待重抽"):
            raise ValueError(f"{get_field_label(field_key)}当前不能献祭。")

    for field_key in field_keys:
        source_entry_id = sources[field_key]
        add_restriction(store, participant["id"], source_entry_id, field_key, "sacrifice")
        add_to_second_pool(
            store,
            source_entry_id,
            field_key,
            result[field_key],
            "sacrifice",
            participant["id"],
        )
        result[field_key] = "待重抽"
        sources[field_key] = None

    result["pending_sacrifices"] = field_keys
    result["pending_previous_slip"] = previous_slip
    result.pop("ritual_failures", None)
    result.pop("ritual_failure_round", None)
    result["sacrifice_round"] = store["settings"]["second_round"]
    result["updated_at"] = now()
    return result


def assign_pool_items(store, participants, pool_items, field_key):
    restrictions = {
        (item["participant_id"], item["entry_id"])
        for item in store["restrictions"]
        if item["field_key"] in (field_key, "all")
    }
    assignments = {}
    for participant in participants:
        available = [
            item for item in pool_items
            if (participant["id"], item["entry_id"]) not in restrictions
        ]
        if not available:
            raise ValueError(
                f"{participant['name']} 在第二轮池中没有可抽的{get_field_label(field_key)}。"
            )
        assignments[participant["id"]] = random.choice(available)
    return assignments


def run_second_draw(store):
    if not store["settings"].get("sacrifice_open"):
        raise ValueError("当前没有开启献祭阶段。")
    pending_results = [result for result in store["results"] if result.get("pending_sacrifices")]
    if not pending_results:
        raise ValueError("还没有参与者提交献祭。")

    sacrifice_counts = {
        field["key"]: sum(
            field["key"] in result.get("pending_sacrifices", [])
            for result in pending_results
        )
        for field in DRAW_FIELDS
    }
    failed_fields = set()
    for field_key, count in sacrifice_counts.items():
        if count == 1:
            failed_fields.add(field_key)

    eligible_results = [
        result for result in pending_results
        if any(
            field_key not in failed_fields
            for field_key in result.get("pending_sacrifices", [])
        )
    ]
    eligible_participants = [
        find_by_id(store["participants"], result["participant_id"])
        for result in eligible_results
    ]

    all_assignments = {}
    for field in DRAW_FIELDS:
        pool_items = [
            item for item in store["secondPool"]
            if item["field_key"] == field["key"]
            and not (
                item.get("reason") == "sacrifice"
                and item["field_key"] in failed_fields
            )
        ]
        if eligible_participants:
            all_assignments[field["key"]] = assign_pool_items(
                store, eligible_participants, pool_items, field["key"]
            )

    used_tokens = set()
    pool_history = []
    for result in pending_results:
        participant_failures = []
        second_slip = {
            field["key"]: "无"
            for field in DRAW_FIELDS
        }
        second_slip["sources"] = {
            field["key"]: None
            for field in DRAW_FIELDS
        }
        pending_field_keys = list(result.get("pending_sacrifices", []))
        for field_key in pending_field_keys:
            if field_key in failed_fields:
                original_item = next(
                    (
                        item for item in store["secondPool"]
                        if item["field_key"] == field_key
                        and item.get("participant_id") == result["participant_id"]
                        and item.get("reason") == "sacrifice"
                    ),
                    None,
                )
                if original_item:
                    used_tokens.add((original_item["entry_id"], field_key))
                    pool_history.append({
                        **original_item,
                        "status": "ritual_failed",
                        "round": store["settings"]["second_round"],
                        "resolved_at": now(),
                    })
                    remove_sacrifice_restriction(
                        store,
                        result["participant_id"],
                        original_item["entry_id"],
                        field_key,
                    )
                result[field_key] = "无"
                result.setdefault("sources", {})[field_key] = None
                participant_failures.append(field_key)

        is_eligible = result in eligible_results
        if is_eligible:
            for field in DRAW_FIELDS:
                field_key = field["key"]
                item = all_assignments[field_key][result["participant_id"]]
                result[field_key] = item["value"]
                result.setdefault("sources", {})[field_key] = item["entry_id"]
                second_slip[field_key] = item["value"]
                second_slip["sources"][field_key] = item["entry_id"]
                used_tokens.add((item["entry_id"], field_key))
                pool_history.append({
                    **item,
                    "status": "drawn",
                    "round": store["settings"]["second_round"],
                    "drawn_by": result["participant_id"],
                    "resolved_at": now(),
                })
        result["pending_sacrifices"] = []
        if is_eligible:
            result["previous_slip"] = result.get("pending_previous_slip", {})
            result["second_slip"] = second_slip
            result["has_second_slip"] = True
        else:
            result.pop("previous_slip", None)
            result.pop("second_slip", None)
            result.pop("has_second_slip", None)
        result.pop("pending_previous_slip", None)
        if participant_failures:
            result["ritual_failures"] = participant_failures
            result["ritual_failure_round"] = store["settings"]["second_round"]
        else:
            result.pop("ritual_failures", None)
            result.pop("ritual_failure_round", None)
        result["last_redraw_round"] = store["settings"]["second_round"]
        result["updated_at"] = now()

    store["secondPool"] = [
        item for item in store["secondPool"]
        if (item["entry_id"], item["field_key"]) not in used_tokens
    ]
    store["secondPoolHistory"].extend(pool_history)
    store["settings"]["sacrifice_open"] = False
    store["settings"]["phase"] = "second_drawn"
    return len(pending_results)


def unlock_side_quest(store, participant):
    if participant.get("side_quest_used"):
        raise ValueError("该参与者已经完成过支线。")
    participant["side_quest_unlocked"] = True


def use_side_quest(store, participant, result, field_key):
    if result.get("fixed"):
        raise ValueError("这支签已经供奉，不能再删除词条。")
    if not participant.get("side_quest_unlocked") or participant.get("side_quest_used"):
        raise ValueError("你没有可用的支线机会。")
    if not is_valid_field(field_key):
        raise ValueError("请选择要删除的部位词条。")
    source_entry_id = (result.get("sources") or {}).get(field_key)
    if not source_entry_id or result.get(field_key) in ("无", "普通人类", "待重抽"):
        raise ValueError("这个部位当前不能删除。")
    add_to_second_pool(
        store, source_entry_id, field_key, result[field_key], "side_quest", participant["id"]
    )
    result[field_key] = "普通人类"
    result["sources"][field_key] = None
    result["updated_at"] = now()
    participant["side_quest_unlocked"] = False
    participant["side_quest_used"] = True
    return result


def fight_for_field(store, winner, loser, field_key):
    if store["settings"].get("phase") not in ("first_drawn", "second_drawn"):
        raise ValueError("只能在抽取完成后进行打架。")
    if winner["id"] == loser["id"]:
        raise ValueError("胜者和败者不能是同一个人。")
    if not is_valid_field(field_key):
        raise ValueError("请选择争夺的部位。")
    winner_result = find_result_for_participant(store, winner["id"])
    loser_result = find_result_for_participant(store, loser["id"])
    if not winner_result or not loser_result:
        raise ValueError("没有找到双方的抽取结果。")
    if winner_result.get("fixed") or loser_result.get("fixed"):
        raise ValueError("已供奉的签不能参与打架。")
    loser_source = (loser_result.get("sources") or {}).get(field_key)
    if not loser_source or loser_result.get(field_key) in ("无", "普通人类", "待重抽"):
        raise ValueError("败者这个部位没有可被抢走的词条。")

    winner_source = (winner_result.get("sources") or {}).get(field_key)
    if winner_source:
        add_to_second_pool(
            store,
            winner_source,
            field_key,
            winner_result[field_key],
            "fight_replaced",
            winner["id"],
        )
    winner_result[field_key] = loser_result[field_key]
    winner_result.setdefault("sources", {})[field_key] = loser_source
    winner_result["updated_at"] = now()
    loser_result[field_key] = "无"
    loser_result.setdefault("sources", {})[field_key] = None
    loser_result["updated_at"] = now()


def build_overview(store):
    participants = sorted(store["participants"], key=lambda item: item["name"])
    entries = sorted(store["entries"], key=lambda item: item["id"], reverse=True)

    restrictions = []
    for restriction in store["restrictions"]:
        participant = find_by_id(store["participants"], restriction["participant_id"])
        entry = find_by_id(store["entries"], restriction["entry_id"])
        if participant and entry:
            field_key = restriction["field_key"]
            restrictions.append({
                **restriction,
                "participant_name": participant["name"],
                "entry_title": entry["title"],
                "field_label": "全部字段" if field_key == "all" else get_field_label(field_key),
                "field_value": "整条旧限制" if field_key == "all" else entry.get(field_key, ""),
            })

    results = []
    for result in store["results"]:
        participant = find_by_id(store["participants"], result["participant_id"])
        if participant:
            results.append({
                "participant_id": participant["id"],
                "participant_name": participant["name"],
                "entry_title": "随机组合",
                "head": result.get("head", ""),
                "torso": result.get("torso", ""),
                "upper_limbs": result.get("upper_limbs", ""),
                "lower_limbs": result.get("lower_limbs", ""),
                "feature_one": result.get("feature_one", ""),
                "feature_two": result.get("feature_two", ""),
                "personality": result.get("personality", ""),
                "sources": result.get("sources", {}),
                "fixed": result.get("fixed", False),
                "fixed_at": result.get("fixed_at", ""),
                "pending_sacrifices": result.get("pending_sacrifices", []),
                "last_redraw_round": result.get("last_redraw_round", 0),
                "ritual_failures": result.get("ritual_failures", []),
                "has_second_slip": result.get("has_second_slip", False),
                "previous_slip": result.get("previous_slip", {}),
                "second_slip": result.get("second_slip", {}),
            })

    field_blocks = []
    for block in store["fieldBlocks"]:
        entry = find_by_id(store["entries"], block["entry_id"])
        field_blocks.append({
            **block,
            "field_label": get_field_label(block["field_key"]),
            "field_value": entry.get(block["field_key"], "") if entry else "",
            "entry_title": entry.get("title", "") if entry else "",
        })

    return {
        "participants": participants,
        "entries": entries,
        "restrictions": sorted(restrictions, key=lambda item: item["participant_name"]),
        "results": sorted(results, key=lambda item: item["participant_name"]),
        "fieldBlocks": field_blocks,
        "fields": DRAW_FIELDS,
        "drawLocked": store["settings"].get("draw_locked") == "1",
        "phase": store["settings"].get("phase", "submission"),
        "sacrificeOpen": bool(store["settings"].get("sacrifice_open")),
        "secondRound": int(store["settings"].get("second_round") or 0),
        "secondPool": store.get("secondPool", []),
        "secondPoolHistory": store.get("secondPoolHistory", []),
        "firstDrawUsedCount": len(store.get("firstDrawUsed", [])),
    }


def export_csv(store):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "participant",
        "head",
        "torso",
        "upper_limbs",
        "lower_limbs",
        "feature_one",
        "feature_two",
        "personality",
    ])
    writer.writeheader()
    for result in store["results"]:
        participant = find_by_id(store["participants"], result["participant_id"])
        if participant:
            writer.writerow({
                "participant": participant["name"],
                "head": result.get("head", ""),
                "torso": result.get("torso", ""),
                "upper_limbs": result.get("upper_limbs", ""),
                "lower_limbs": result.get("lower_limbs", ""),
                "feature_one": result.get("feature_one", ""),
                "feature_two": result.get("feature_two", ""),
                "personality": result.get("personality", ""),
            })
    return output.getvalue()


def find_by_id(items, item_id):
    return next((item for item in items if item["id"] == item_id), None)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@app.get("/")
def index_page():
    return send_from_directory("public", "index.html")


@app.get("/admin")
def admin_page():
    return send_from_directory("public", "admin.html")


@app.post("/api/admin/login")
def admin_login():
    data = request.get_json(silent=True) or {}
    if data.get("password") != get_admin_password():
        return jsonify({"ok": False, "error": "密码不正确。"}), 401

    response = make_response(jsonify({"ok": True}))
    response.set_cookie(
        ADMIN_COOKIE,
        make_session_value(),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=os.environ.get("FLASK_ENV") == "production",
    )
    return response


@app.post("/api/admin/logout")
def admin_logout():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    response = make_response(jsonify({"ok": True}))
    response.delete_cookie(ADMIN_COOKIE)
    return response


@app.get("/api/state")
def state():
    store = load_store()
    return jsonify({
        "ok": True,
        "drawLocked": store["settings"].get("draw_locked") == "1",
        "resultCount": len(store["results"]),
        "phase": store["settings"].get("phase", "submission"),
    })


@app.post("/api/entries")
def create_entry():
    store = load_store()
    data = request.get_json(silent=True) or {}
    creator_name = str(data.get("creatorName", "")).strip()
    if not creator_name:
        return jsonify({"ok": False, "error": "提交人必填。"}), 400
    if creator_name_exists(store, creator_name):
        return jsonify({"ok": False, "error": "这个名字已经提交过词条，不能重复提交。"}), 400
    if store["settings"].get("draw_locked") == "1":
        return jsonify({"ok": False, "error": "已经开奖，不能继续提交词条。"}), 400

    fields = {
        "head": str(data.get("head", "")).strip(),
        "torso": str(data.get("torso", "")).strip(),
        "upperLimbs": str(data.get("upperLimbs", "")).strip(),
        "lowerLimbs": str(data.get("lowerLimbs", "")).strip(),
        "featureOne": str(data.get("featureOne", "")).strip(),
        "featureTwo": str(data.get("featureTwo", "")).strip(),
        "personality": str(data.get("personality", "")).strip(),
    }
    if any(not value for value in fields.values()):
        return jsonify({"ok": False, "error": "请填写完整的头、躯干、上肢、下肢、两个自由特征和性格。"}), 400

    entry = add_entry(store, {"creatorName": creator_name, **fields})
    save_store(store)
    return jsonify({"ok": True, "id": entry["id"]})


@app.get("/api/results/<name>")
def get_result(name):
    store = load_store()
    participant = next((item for item in store["participants"] if item["name"] == name.strip()), None)
    result = participant and next(
        (item for item in store["results"] if item["participant_id"] == participant["id"]),
        None,
    )
    if not result:
        return jsonify({"ok": False, "error": "没有找到结果。请确认名字完全一致，或等待管理员开奖。"}), 404
    return jsonify({"ok": True, "result": {
        "participant_name": participant["name"],
        "title": f"{participant['name']} 的随机组合",
        "fields": DRAW_FIELDS,
        "phase": store["settings"].get("phase", "submission"),
        "sacrifice_open": bool(store["settings"].get("sacrifice_open")),
        "second_round": int(store["settings"].get("second_round") or 0),
        "side_quest_unlocked": participant.get("side_quest_unlocked", False),
        "side_quest_used": participant.get("side_quest_used", False),
        **result,
    }})


@app.post("/api/results/<name>/fix")
def fix_public_result(name):
    store = load_store()
    participant = next((item for item in store["participants"] if item["name"] == name.strip()), None)
    result = participant and find_result_for_participant(store, participant["id"])
    if not result:
        return jsonify({"ok": False, "error": "没有找到可供奉的结果。"}), 404
    if result.get("pending_sacrifices"):
        return jsonify({"ok": False, "error": "这支签有等待重抽的部位，暂时不能供奉。"}), 400
    fix_result(store, participant, result)
    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/results/<name>/sacrifice")
def sacrifice_public_result(name):
    store = load_store()
    data = request.get_json(silent=True) or {}
    field_keys = [str(item) for item in data.get("fieldKeys", [])]
    participant = next((item for item in store["participants"] if item["name"] == name.strip()), None)
    result = participant and find_result_for_participant(store, participant["id"])
    if not result:
        return jsonify({"ok": False, "error": "没有找到可献祭的结果。"}), 404

    try:
        new_result = submit_sacrifices(store, participant, result, field_keys)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    save_store(store)
    return jsonify({"ok": True, "result": {
        "participant_name": participant["name"],
        "title": f"{participant['name']} 的随机组合",
        "fields": DRAW_FIELDS,
        **new_result,
    }})


@app.post("/api/results/<name>/side-quest")
def use_public_side_quest(name):
    store = load_store()
    data = request.get_json(silent=True) or {}
    participant = next((item for item in store["participants"] if item["name"] == name.strip()), None)
    result = participant and find_result_for_participant(store, participant["id"])
    if not participant or not result:
        return jsonify({"ok": False, "error": "没有找到可操作的结果。"}), 404
    try:
        use_side_quest(store, participant, result, str(data.get("fieldKey", "")))
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400
    save_store(store)
    return jsonify({"ok": True, "result": {
        "participant_name": participant["name"],
        "title": f"{participant['name']} 的随机组合",
        "fields": DRAW_FIELDS,
        "side_quest_unlocked": participant.get("side_quest_unlocked", False),
        "side_quest_used": participant.get("side_quest_used", False),
        **result,
    }})


@app.get("/api/admin/overview")
def admin_overview():
    auth_error = require_admin()
    if auth_error:
        return auth_error
    return jsonify({"ok": True, **build_overview(load_store())})


@app.post("/api/admin/participants")
def create_participants():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    data = request.get_json(silent=True) or {}
    names = [
        name.strip()
        for chunk in str(data.get("names", "")).splitlines()
        for name in chunk.split(",")
        if name.strip()
    ]
    if not names:
        return jsonify({"ok": False, "error": "请输入至少一个参与者名字。"}), 400
    for name in names:
        add_participant(store, name)
    save_store(store)
    return jsonify({"ok": True})


@app.delete("/api/admin/participants/<int:participant_id>")
def delete_participant(participant_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    remove_participant(store, participant_id)
    save_store(store)
    return jsonify({"ok": True})


@app.patch("/api/admin/field-blocks")
def update_field_block():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    data = request.get_json(silent=True) or {}
    entry_id = int(data.get("entryId") or 0)
    field_key = str(data.get("fieldKey", ""))
    if not entry_id or not is_valid_field(field_key):
        return jsonify({"ok": False, "error": "请选择要全员禁抽的字段词条。"}), 400
    set_field_blocked(store, entry_id, field_key, bool(data.get("globallyBlocked")))
    save_store(store)
    return jsonify({"ok": True})


@app.delete("/api/admin/entries/<int:entry_id>")
def delete_entry(entry_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    remove_entry(store, entry_id)
    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/admin/restrictions")
def create_restriction():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    data = request.get_json(silent=True) or {}
    participant_id = int(data.get("participantId") or 0)
    entry_id = int(data.get("entryId") or 0)
    field_key = str(data.get("fieldKey", ""))
    if not participant_id or not entry_id or not is_valid_field(field_key):
        return jsonify({"ok": False, "error": "请选择参与者、字段和词条。"}), 400
    add_restriction(store, participant_id, entry_id, field_key)
    save_store(store)
    return jsonify({"ok": True})


@app.delete("/api/admin/restrictions")
def delete_restriction():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    data = request.get_json(silent=True) or {}
    remove_restriction(
        store,
        int(data.get("participantId") or 0),
        int(data.get("entryId") or 0),
        str(data.get("fieldKey", "")),
    )
    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/admin/fixed-results/<int:participant_id>")
def create_fixed_result(participant_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    participant = find_by_id(store["participants"], participant_id)
    result = participant and find_result_for_participant(store, participant_id)
    if not participant or not result:
        return jsonify({"ok": False, "error": "没有找到可固定的结果。"}), 404

    fix_result(store, participant, result)
    save_store(store)
    return jsonify({"ok": True})


@app.patch("/api/admin/fixed-results/<int:participant_id>")
def edit_fixed_result(participant_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    data = request.get_json(silent=True) or {}
    participant = find_by_id(store["participants"], participant_id)
    result = participant and find_result_for_participant(store, participant_id)
    if not participant or not result:
        return jsonify({"ok": False, "error": "没有找到这个固定结果。"}), 404

    try:
        update_fixed_result_field(
            store,
            participant,
            result,
            str(data.get("fieldKey", "")),
            int(data.get("entryId") or 0),
        )
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    save_store(store)
    return jsonify({"ok": True})


@app.delete("/api/admin/fixed-results/<int:participant_id>")
def delete_fixed_result(participant_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    participant = find_by_id(store["participants"], participant_id)
    result = participant and find_result_for_participant(store, participant_id)
    if not participant or not result:
        return jsonify({"ok": False, "error": "没有找到这个固定结果。"}), 404

    try:
        unfix_result(store, participant, result)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/admin/draw")
def draw():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    try:
        count = run_draw(store)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400
    save_store(store)
    return jsonify({"ok": True, "count": count})


@app.post("/api/admin/sacrifice-round/open")
def open_admin_sacrifice_round():
    auth_error = require_admin()
    if auth_error:
        return auth_error
    store = load_store()
    try:
        open_sacrifice_round(store)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400
    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/admin/second-draw")
def admin_second_draw():
    auth_error = require_admin()
    if auth_error:
        return auth_error
    store = load_store()
    try:
        count = run_second_draw(store)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400
    save_store(store)
    return jsonify({"ok": True, "count": count})


@app.post("/api/admin/side-quest/<int:participant_id>/unlock")
def admin_unlock_side_quest(participant_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error
    store = load_store()
    participant = find_by_id(store["participants"], participant_id)
    if not participant:
        return jsonify({"ok": False, "error": "没有找到参与者。"}), 404
    try:
        unlock_side_quest(store, participant)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400
    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/admin/fight")
def admin_fight():
    auth_error = require_admin()
    if auth_error:
        return auth_error
    store = load_store()
    data = request.get_json(silent=True) or {}
    winner_name = str(data.get("winnerName", "")).strip()
    loser_name = str(data.get("loserName", "")).strip()
    winner = next((item for item in store["participants"] if item["name"] == winner_name), None)
    loser = next((item for item in store["participants"] if item["name"] == loser_name), None)
    if not winner or not loser:
        return jsonify({"ok": False, "error": "请选择胜者和败者。"}), 400
    try:
        fight_for_field(store, winner, loser, str(data.get("fieldKey", "")))
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400
    save_store(store)
    return jsonify({"ok": True})


@app.post("/api/admin/reset-draw")
def reset_draw():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    store["results"] = []
    store["secondPool"] = []
    store["secondPoolHistory"] = []
    store["firstDrawUsed"] = []
    store["restrictions"] = [
        item for item in store["restrictions"]
        if item.get("reason", "manual") != "sacrifice"
    ]
    store["fieldBlocks"] = [
        item for item in store["fieldBlocks"]
        if item.get("reason") != "fixed_result"
    ]
    for participant in store["participants"]:
        participant["side_quest_unlocked"] = False
        participant["side_quest_used"] = False
    store["settings"]["draw_locked"] = "0"
    store["settings"]["phase"] = "submission"
    store["settings"]["second_round"] = 0
    store["settings"]["sacrifice_open"] = False
    save_store(store)
    return jsonify({"ok": True})


@app.get("/api/admin/export.csv")
def export_results():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    csv_text = export_csv(load_store())
    return Response(
        "\ufeff" + csv_text,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=draw-results.csv"},
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=True)
