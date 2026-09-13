"""Execute the shipped Lua action bodies against a deterministic game fixture.

Install test-only dependency: python -m pip install lupa==2.8.
This is not a real DST server, physics, network or multiplayer acceptance test.
"""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import test_mod_requests

try:
    from lupa.lua51 import LuaRuntime
except ImportError:
    LuaRuntime = None


class SkillBridgeLifecycleTests(unittest.TestCase):
    def test_expired_or_precancelled_request_never_reaches_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = test_mod_requests.ModRequestTests().make_app(Path(directory))
            with self.assertRaisesRegex(RuntimeError, "过期"):
                app._execute_game_atom("dst.find_nearest_entity", {}, "old", time.time() - 1)
            app._on_harness_notification("game.atom.cancel", {"commandId": "cancelled"})
            with self.assertRaisesRegex(RuntimeError, "取消"):
                app._execute_game_atom("dst.find_nearest_entity", {}, "cancelled", time.time() + 20)
            self.assertFalse(app.settings.skill_command_file.exists())

    def test_cancellation_and_disconnect_retire_command_and_release_lock(self):
        for event in ["game.atom.cancel", "game.atom.disconnected"]:
            with self.subTest(event=event), tempfile.TemporaryDirectory() as directory:
                app, _ = test_mod_requests.ModRequestTests().make_app(Path(directory))
                def notify(_seconds):
                    app._on_harness_notification(event, {"commandId": "current"})
                with patch("dont_starve_ai_mod.app.time.sleep", side_effect=notify):
                    with self.assertRaisesRegex(RuntimeError, "取消|断开"):
                        app._execute_game_atom("dst.find_nearest_entity", {}, "current", time.time() + 20)
                command = json.loads(app.settings.skill_command_file.read_text(encoding="utf-8"))
                self.assertTrue(command["cancelled"])
                self.assertFalse(app._skill_busy.locked())


@unittest.skipIf(LuaRuntime is None, "Lua behavioral tests require test-only lupa==2.8")
class LuaSkillLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(unpack_returned_tuples=True)
        source = (Path(__file__).parents[1] / "game-mod" / "modmain.lua").read_text(encoding="utf-8")
        # Compile the whole Mod as well; execute only the actual skill bodies.
        self.lua.execute("assert(loadstring(...))", source)
        prefix = '''
        now=100; hp=1; damage=0; restarted=0; stopped=0; inventory_full=false; collected=false
        GLOBAL={os={time=function() return now end}, Ents={}, TheNet={IsDedicated=function() return false end}}
        function write_json(path,payload) result=payload; return true end
        function diagnostic() end
        SKILL_RESULT_PATH="result"; SKILL_COMMAND_PATH="command"; RPC_NAMESPACE="test"
        function read_json() return disk_command end
        json={encode=function(x) return x end}
        MOD_RPC={test={skill_atom=1,skill_lease=2}}; sends={}
        function SendModRPCToServer(rpc,...) table.insert(sends,rpc) end
        handlers={}; function AddModRPCHandler(namespace,name,fn) handlers[name]=fn end
        JINGLING_VISUAL_STRIKE=1
        function set_jingling_visual_mode() end
        health={IsDead=function() return hp<=0 end}
        target={GUID=42,prefab="butterfly",IsValid=function() return true end,
          Transform={GetWorldPosition=function() return 1,0,2 end},
          GetPosition=function() return {} end,
          components={health=health,combat={GetAttacked=function(_,player,value) hp=hp-value; damage=damage+value end}}}
        GLOBAL.Ents[42]=target
        loot={GUID=84,prefab="butterflywings",components={inventoryitem={}},IsValid=function() return not collected end,GetPosition=function() return {} end}
        entities={}
        GLOBAL.TheSim={FindEntities=function() return entities end}
        player={userid="player",IsValid=function() return true end,HasTag=function() return false end,
          Transform={GetWorldPosition=function() return 0,0,0 end},GetDistanceSqToInst=function() return 1 end,
          _chester_ai_skill_lease={id="cmd",expires=130,until_time=103}}
        chester={IsValid=function() return true end,StopBrain=function() end,
          RestartBrain=function() restarted=restarted+1 end,
          GetDistanceSqToInst=function() return 1 end,
          DoPeriodicTask=function(_,interval,fn) tick=fn; return {Cancel=function() cancelled=true end} end,
          components={locomotor={Stop=function() stopped=stopped+1 end,GoToPoint=function() end},
            container={GiveItem=function() if inventory_full then return false end; collected=true; entities={}; return true end}}}
        function ensure_player_chester() return chester end
        '''
        body = source.split("local function send_skill_result", 1)[1].split("local function write_state", 1)[0]
        lease_handler = 'AddModRPCHandler(RPC_NAMESPACE, "skill_lease"' + source.split('AddModRPCHandler(RPC_NAMESPACE, "skill_lease"', 1)[1].split('\nend)', 1)[0] + '\nend)'
        self.api = self.lua.execute(prefix + "\nlocal function send_skill_result" + body +
                                    '\n' + lease_handler + '\nreturn {execute=execute_skill_atom,poll=poll_skill_command,lease=handlers.skill_lease}')

    def execute(self, atom, **args):
        self.api.execute(self.lua.globals().player, "cmd", atom, self.lua.table_from(args, recursive=True))

    def test_expired_lease_cannot_start_an_action(self):
        self.lua.execute("now=131")
        self.execute("dst.attack_target", targetId=42)
        self.assertFalse(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().damage, 0)

    def test_lost_lease_stops_motion_before_damage_and_restores_brain(self):
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute("now=104; tick()")
        self.assertFalse(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().damage, 0)
        self.assertEqual(self.lua.globals().restarted, 1)
        self.assertIsNone(self.lua.globals().player._chester_ai_skill_task)

    def test_attack_does_not_lie_when_target_survives(self):
        self.lua.execute("hp=2")
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute("tick()")
        self.assertTrue(self.lua.globals().result.success)
        self.assertFalse(self.lua.globals().result.result.defeated)

    def test_attack_verifies_actual_death(self):
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute("tick()")
        self.assertTrue(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().hp, 0)

    def test_target_killed_by_someone_else_before_hit_is_not_our_success(self):
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute("hp=0; tick()")
        self.assertFalse(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().damage, 0)

    def test_same_find_and_attack_atoms_support_non_butterfly_target(self):
        self.lua.execute('target.prefab="rabbit"; entities={target}')
        self.execute("dst.find_nearest_entity", prefab="rabbit")
        self.assertEqual(self.lua.globals().result.result.prefab, "rabbit")
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute("tick()")
        self.assertTrue(self.lua.globals().result.result.defeated)

    def test_find_supports_non_combat_entity_and_explicit_prefab_list(self):
        self.lua.execute('target.prefab="evergreen"; target.components={}; entities={target}')
        self.execute("dst.find_nearest_entity", prefabs=["evergreen", "deciduoustree"])
        self.assertEqual(self.lua.globals().result.result.prefab, "evergreen")
        self.execute("dst.attack_target", targetId=42)
        self.assertFalse(self.lua.globals().result.success)

    def test_generic_pickup_supports_logs_without_prior_combat(self):
        self.lua.execute('loot.prefab="log"; entities={loot}')
        self.execute("dst.collect_items", prefab="log", x=1, z=2)
        self.lua.execute("for i=1,12 do tick() end")
        self.assertTrue(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().result.result["items"][1], "log")

    def test_search_cannot_silently_choose_an_unrequested_prefab(self):
        self.lua.execute('entities={target}')
        self.execute("dst.find_nearest_entity", prefab="rabbit")
        self.assertFalse(self.lua.globals().result.success)
        self.execute("dst.find_nearest_entity")
        self.assertFalse(self.lua.globals().result.success)

    def test_attack_rejects_player_and_missing_health_during_pursuit(self):
        self.lua.execute('target.HasTag=function(_,tag) return tag=="player" end')
        self.execute("dst.attack_target", targetId=42)
        self.assertFalse(self.lua.globals().result.success)
        self.lua.execute('target.HasTag=nil')
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute('target.components.health=nil; tick()')
        self.assertFalse(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().damage, 0)

    def test_pickup_rejects_unbounded_remote_position(self):
        self.execute("dst.collect_items", prefab="log", x=1000, z=1000)
        self.assertFalse(self.lua.globals().result.success)
        self.assertIsNone(self.lua.globals().tick)

    def test_short_pause_can_resume_only_with_a_live_renewed_lease(self):
        self.execute("dst.attack_target", targetId=42)
        self.lua.execute("now=105")
        self.api.lease(self.lua.globals().player, "cmd", 130, 108)
        self.lua.execute("tick()")
        self.assertTrue(self.lua.globals().result.success)

    def test_full_container_is_not_success(self):
        self.lua.execute("entities={loot}; inventory_full=true")
        self.execute("dst.collect_items", prefabs=["butterflywings", "butter"], x=1, z=2)
        self.lua.execute("tick()")
        self.assertFalse(self.lua.globals().result.success)

    def test_pickup_success_requires_item_received(self):
        self.lua.execute("entities={loot}")
        self.execute("dst.collect_items", prefabs=["butterflywings", "butter"], x=1, z=2)
        self.lua.execute("for i=1,12 do tick() end")
        self.assertTrue(self.lua.globals().result.success)
        self.assertEqual(self.lua.globals().result.result.count, 1)

    def test_no_loot_is_failure(self):
        self.execute("dst.collect_items", prefabs=["butterflywings", "butter"], x=1, z=2)
        self.lua.execute("for i=1,12 do tick() end")
        self.assertFalse(self.lua.globals().result.success)

    def test_caller_can_exclude_preexisting_items_without_mod_task_state(self):
        self.lua.execute("entities={loot}")
        self.execute("dst.collect_items", prefabs=["butterflywings", "butter"], excludeIds=[84], x=1, z=2)
        self.lua.execute("for i=1,12 do tick() end")
        self.assertFalse(self.lua.globals().result.success)
        self.assertFalse(self.lua.globals().collected)

    def test_resuming_after_deadline_does_not_dispatch_old_command(self):
        self.lua.execute('disk_command={id="old",atom="dst.attack_target",expires_at_unix=99,lease_until_unix=99}')
        self.api.poll()
        self.assertFalse(self.lua.globals().result.success)
        self.assertNotIn(1, list(self.lua.globals().sends.values()))

    def test_real_python_bridge_and_lua_actions_exchange_files_for_complete_hunt(self):
        """No canned atom results: Python reads results produced by Lua bodies."""
        with tempfile.TemporaryDirectory() as directory:
            app, _ = test_mod_requests.ModRequestTests().make_app(Path(directory))
            def to_python(value):
                if hasattr(value, "items") and not isinstance(value, dict):
                    values = dict(value.items())
                    if values and all(isinstance(key, int) for key in values):
                        return [to_python(values[key]) for key in sorted(values)]
                    return {key: to_python(item) for key, item in values.items()}
                return value

            def disk_read(_path):
                try:
                    return self.lua.table_from(json.loads(app.settings.skill_command_file.read_text(encoding="utf-8")), recursive=True)
                except (OSError, json.JSONDecodeError):
                    return None

            def disk_write(_path, payload):
                app.settings.skill_result_file.write_text(json.dumps(to_python(payload)), encoding="utf-8")
                return True

            def rpc(kind, command_id, *args):
                if kind == 2:
                    self.api.lease(self.lua.globals().player, command_id, args[0], args[1])
                else:
                    self.lua.globals().cancelled = False
                    self.lua.globals().tick = None
                    self.api.execute(self.lua.globals().player, command_id, args[0], args[1])

            self.lua.globals().read_json = disk_read
            self.lua.globals().write_json = disk_write
            self.lua.globals().SendModRPCToServer = rpc
            self.lua.execute('entities={target}; target.components.combat.GetAttacked=function(_,player,value) hp=hp-value; entities={loot} end')
            def call(atom, arguments):
                results, errors = [], []
                def run():
                    try:
                        results.append(app._on_harness_request("game.atom.execute", {"atom": atom, "arguments": arguments}))
                    except Exception as exc:
                        errors.append(exc)
                worker = threading.Thread(target=run, daemon=True)
                worker.start()
                deadline = time.monotonic() + 3
                try:
                    while worker.is_alive() and time.monotonic() < deadline:
                        self.lua.globals().now = time.time()
                        self.api.poll()
                        if self.lua.globals().tick and not self.lua.globals().cancelled:
                            self.lua.globals().tick()
                        time.sleep(0.005)
                finally:
                    if worker.is_alive():
                        app._on_harness_notification("game.atom.disconnected", {})
                    worker.join(timeout=1)
                self.assertFalse(worker.is_alive())
                self.assertEqual(errors, [])
                return results[0]

            found = call("dst.find_nearest_entity", {"prefab": "butterfly", "radius": 20})
            killed = call("dst.attack_target", {"targetId": found["targetId"]})
            loot = call("dst.collect_items", {"prefabs": ["butterflywings", "butter"], "x": killed["x"], "z": killed["z"], "radius": 4})
            self.assertTrue(killed["defeated"])
            self.assertEqual(loot, {"count": 1, "items": ["butterflywings"]})
