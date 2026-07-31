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
    "settings": {"draw_locked": "0"},
    "participants": [],
    "entries": [],
    "fieldBlocks": [],
    "restrictions": [],
    "results": [],
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
        if block["entry_id"] != entry_id or block["field_key"] != field_key
    ]
    if blocked:
        store["fieldBlocks"].append({
            "entry_id": entry_id,
            "field_key": field_key,
            "created_at": now(),
        })


def add_restriction(store, participant_id, entry_id, field_key):
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
        })


def remove_restriction(store, participant_id, entry_id, field_key):
    store["restrictions"] = [
        restriction for restriction in store["restrictions"]
        if restriction["participant_id"] != participant_id
        or restriction["entry_id"] != entry_id
        or restriction["field_key"] != field_key
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


def run_draw(store):
    if store["settings"].get("draw_locked") == "1":
        raise ValueError("已经开奖。如需重新开奖，请先重置结果。")

    participants = sorted(store["participants"], key=lambda item: item["name"])
    entries = list(store["entries"])
    if not participants:
        raise ValueError("还没有参与者。")
    if not entries:
        raise ValueError("还没有可抽提交。")

    field_assignments = {
        field["key"]: assign_field(store, participants, entries, field)
        for field in DRAW_FIELDS
    }

    results = []
    for participant in participants:
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
    store["settings"]["draw_locked"] = "1"
    return len(results)


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
                "participant_name": participant["name"],
                "entry_title": "随机组合",
                "head": result.get("head", ""),
                "torso": result.get("torso", ""),
                "upper_limbs": result.get("upper_limbs", ""),
                "lower_limbs": result.get("lower_limbs", ""),
                "feature_one": result.get("feature_one", ""),
                "feature_two": result.get("feature_two", ""),
                "personality": result.get("personality", ""),
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
    })


@app.post("/api/entries")
def create_entry():
    store = load_store()
    data = request.get_json(silent=True) or {}
    creator_name = str(data.get("creatorName", "")).strip()
    if not creator_name:
        return jsonify({"ok": False, "error": "提交人必填。"}), 400
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


@app.post("/api/admin/reset-draw")
def reset_draw():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    store = load_store()
    store["results"] = []
    store["settings"]["draw_locked"] = "0"
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
