import tempfile
import unittest
from pathlib import Path

import app


class AppSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_store_path = app.STORE_PATH
        self.original_lock_path = app.STORE_LOCK_PATH
        root = Path(self.temp_dir.name)
        app.STORE_PATH = root / "store.json"
        app.STORE_LOCK_PATH = root / "store.lock"
        self.client = app.app.test_client()
        self.client.post("/api/admin/login", json={"password": "admin"})

    def tearDown(self):
        app.STORE_PATH = self.original_store_path
        app.STORE_LOCK_PATH = self.original_lock_path
        self.temp_dir.cleanup()

    def assert_json_error(self, response, status):
        self.assertEqual(response.status_code, status)
        self.assertTrue(response.is_json)
        self.assertIn("error", response.get_json())

    def test_malformed_ids_return_json_400(self):
        response = self.client.patch(
            "/api/admin/field-blocks",
            json={"entryId": "oops", "fieldKey": "head", "globallyBlocked": True},
        )
        self.assert_json_error(response, 400)

        response = self.client.post(
            "/api/admin/restrictions",
            json={"participantId": "oops", "entryId": 1, "fieldKey": "head"},
        )
        self.assert_json_error(response, 400)

    def test_invalid_field_keys_and_json_root_return_400(self):
        self.assert_json_error(
            self.client.post("/api/results/x/sacrifice", json={"fieldKeys": None}),
            400,
        )
        self.assert_json_error(self.client.post("/api/entries", json=[]), 400)

    def test_corrupt_primary_store_uses_backup(self):
        first = {**app.INITIAL_DATA, "participants": [{"id": 1, "name": "备份数据"}]}
        second = {**app.INITIAL_DATA, "participants": [{"id": 2, "name": "当前数据"}]}
        app.save_store(first)
        app.save_store(second)
        app.STORE_PATH.write_text("{broken", encoding="utf-8")

        loaded = app.load_store()
        self.assertEqual(loaded["participants"][0]["name"], "备份数据")

    def test_unrecoverable_store_returns_json_500(self):
        app.STORE_PATH.write_text("{broken", encoding="utf-8")
        app.store_backup_path().write_text("{also broken", encoding="utf-8")
        self.assert_json_error(self.client.get("/api/state"), 500)


if __name__ == "__main__":
    unittest.main()
