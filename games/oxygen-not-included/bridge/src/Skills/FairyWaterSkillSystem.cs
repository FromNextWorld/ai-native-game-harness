using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using DoubaoAI.ONI.Commands;
using Klei;
using Newtonsoft.Json;
using UnityEngine;

namespace DoubaoAI.ONI.Skills
{
    internal sealed class FairyWaterSkillSystem
    {
        internal const float CapacityKg = 1000f;
        internal const float SprayMassKg = 200f;
        private const int MaximumRangeCells = 12;

        private readonly string _statePath;
        private readonly CellAddRemoveSubstanceEvent _absorbEvent =
            new CellAddRemoveSubstanceEvent("XiaoTangYuanAbsorbWater", "小汤圆吸水");
        private FairyWaterSkillState _state;
        private Action<PlayerCommandExecutionResult> _completion;
        private float _startedAt;
        private bool _disposed;
        private bool _persistenceFault;
        internal event Action<PlayerCommandExecutionResult> LateResult;
        internal event Action<WaterTransferFeedback> TransferConfirmed;

        internal FairyWaterSkillSystem(string statePath = null)
        {
            _statePath = statePath ?? ResolveStatePath();
            _state = Load(_statePath);
        }

        internal bool Learned => _state.Learned;
        internal float StoredMassKg => _state.StoredMassKg;
        internal string StoredElementName => StoredElement() == null ? "无" : StoredElement().name;

        internal bool TryLearnFromContact(MinionIdentity followedMinion)
        {
            if (_state.Learned || followedMinion == null || followedMinion.gameObject == null) return false;
            int origin = Grid.PosToCell(followedMinion.gameObject);
            if (!Grid.IsValidCell(origin)) return false;

            int[] cells =
            {
                origin,
                Grid.OffsetCell(origin, 0, -1),
                Grid.OffsetCell(origin, -1, 0),
                Grid.OffsetCell(origin, 1, 0)
            };
            foreach (int cell in cells)
            {
                if (!Grid.IsValidCell(cell) || Grid.WorldIdx[cell] != Grid.WorldIdx[origin]) continue;
                Element element = Grid.Element[cell];
                if (!IsWater(element) || Grid.Mass[cell] < 1f) continue;
                _state.Learned = true;
                Save();
                return true;
            }
            return false;
        }

        internal void Absorb(int targetCell, MinionIdentity followedMinion, Action<PlayerCommandExecutionResult> completed)
        {
            PlayerCommandExecutionResult validation = ValidateTransfer(targetCell, followedMinion);
            if (validation != null) { completed(validation); return; }
            if (!_state.Learned) { completed(Failure("我还不会吸水。先带我真正碰一次水吧。")); return; }

            Element element = Grid.Element[targetCell];
            if (!IsWater(element) || Grid.Mass[targetCell] < 1f)
            { completed(Failure("鼠标指的位置没有足够的水。水、污染水、盐水和浓盐水都可以吸。")); return; }
            if (_state.StoredMassKg >= CapacityKg - 0.001f)
            { completed(Failure("我的水肚子已经装满了，先让我喷掉一些吧。")); return; }
            if (_state.StoredMassKg > 0.001f && !string.Equals(_state.StoredElementId, element.id.ToString(), StringComparison.Ordinal))
            { completed(Failure("我肚子里还有另一种水，先喷完才能换着吸。")); return; }

            float sourceMass = Grid.Mass[targetCell];
            float amount = Mathf.Min(sourceMass, CapacityKg - _state.StoredMassKg);
            if (!Begin("absorb", targetCell, amount, completed)) return;
            var game = Game.Instance;
            var handle = game.massConsumedCallbackManager.Add((info, data) =>
            {
                if (_disposed || _state.PendingTransfer == null) return;
                if (info.mass <= 0f)
                { Finish(Failure("游戏确认没有吸到水，储水没有增加。")); return; }
                // The native callback owns the actual amount, temperature and disease, not the old Grid snapshot.
                if (info.elemIdx != element.idx || !ValidMass(info.mass) || info.mass > amount + 0.01f)
                { Uncertain("游戏返回的吸水数据异常，已锁定储水等待核对。"); return; }
                float previousMass = _state.StoredMassKg;
                _state.StoredTemperatureKelvin = SimUtil.CalculateFinalTemperature(previousMass,
                    _state.StoredTemperatureKelvin, info.mass, info.temperature);
                var disease = SimUtil.CalculateFinalDiseaseInfo(_state.StoredDiseaseIndex,
                    _state.StoredDiseaseCount, info.diseaseIdx, info.diseaseCount);
                _state.StoredDiseaseIndex = disease.idx;
                _state.StoredDiseaseCount = disease.count;
                _state.StoredElementId = element.id.ToString();
                _state.StoredMassKg += info.mass;
                _absorbEvent.Log(targetCell, element.id, -info.mass, -1);
                LogResult("absorb", targetCell, sourceMass, info.mass);
                Finish(Success(string.Format(CultureInfo.InvariantCulture,
                    "咕噜——游戏已确认吸进 {0:0.#} kg {1}，现在装着 {2:0.#}/{3:0} kg。",
                    info.mass, element.name, _state.StoredMassKg, CapacityKg)),
                    new WaterTransferFeedback(true, targetCell, info.mass, element.id));
            }, this, "XiaoTangYuanAbsorbWater");
            // Explicit 1x1 rectangle: do not rely on a zero-radius native consumption region.
            SimMessages.ConsumeMass(targetCell, element.id, amount, (byte)1, (byte)1, handle.index);
        }

        internal void Spray(int targetCell, MinionIdentity followedMinion, Action<PlayerCommandExecutionResult> completed)
        {
            PlayerCommandExecutionResult validation = ValidateTransfer(targetCell, followedMinion);
            if (validation != null) { completed(validation); return; }
            if (!_state.Learned) { completed(Failure("我还不会喷水。先带我真正碰一次水吧。")); return; }
            if (_state.StoredMassKg <= 0.001f) { completed(Failure("我的水肚子是空的，先指着水让我吸水吧。")); return; }
            if (Grid.IsSolidCell(targetCell))
            {
                int above = Grid.OffsetCell(targetCell, 0, 1);
                if (ValidateTarget(above, followedMinion) != null || Grid.IsSolidCell(above))
                { completed(Failure("这里是封住的实心地块，上方也没有可喷水的位置。请指向空气、真空、液面或地板表面。")); return; }
                targetCell = above;
            }

            Element stored = StoredElement();
            if (!IsWater(stored) || !ValidMass(_state.StoredMassKg) || !ValidMass(_state.StoredTemperatureKelvin))
            {
                completed(Failure("储水种类、质量或温度无效，已保留原记录，请检查存档。")); return;
            }
            var fallingWater = FallingWater.instance;
            if (fallingWater == null)
            { completed(Failure("游戏液滴系统尚未就绪，储水没有扣除。")); return; }
            // The native spawner offsets droplets within adjacent cells. Keep that whole
            // footprint inside this world, including the possible upward solid adjustment.
            if (!HasSafeParticleFootprint(targetCell))
            { completed(Failure("这里太靠近世界边界，请向地图内侧移动几格再喷水。")); return; }

            float amount = Mathf.Min(SprayMassKg, _state.StoredMassKg);
            int diseaseCount = _state.StoredMassKg <= 0f
                ? 0
                : Mathf.RoundToInt(_state.StoredDiseaseCount * Mathf.Clamp01(amount / _state.StoredMassKg));
            double before;
            try { before = CountNearbyParticles(fallingWater, targetCell, stored.idx); }
            catch (Exception ex)
            {
                Debug.LogWarning("[DoubaoAI][WaterSkill] Particle preflight failed: " + ex);
                completed(Failure("暂时无法读取游戏液滴状态，本次没有喷水，储水没有扣除。")); return;
            }
            if (!Begin("spray", targetCell, amount, completed)) return;
            double actual;
            try
            {
                // Same physical liquid path as ONI's BottleEmptier. Do NOT also EmitMass:
                // these particles already own real mass and deposit it into the simulation.
                // No frame/sim update can interleave this synchronous add and readback.
                fallingWater.AddParticle(targetCell, stored.idx, amount, _state.StoredTemperatureKelvin,
                    _state.StoredDiseaseIndex, diseaseCount, skip_decor: true, disable_randomness: true);
                actual = CountNearbyParticles(fallingWater, targetCell, stored.idx) - before;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DoubaoAI][WaterSkill] Native particle transfer failed: " + ex);
                Uncertain("喷水过程发生异常，已锁定储水避免重复放水，请保留日志核对。");
                return;
            }
            if (double.IsNaN(actual) || double.IsInfinity(actual) || actual <= 0 || Math.Abs(actual - amount) > 0.01)
            { Uncertain("液滴数量未能完整核对，已锁定储水，避免重复喷水；请保留日志核对。"); return; }
            _state.StoredMassKg = Math.Max(0f, _state.StoredMassKg - amount);
            _state.StoredDiseaseCount = Math.Max(0, _state.StoredDiseaseCount - diseaseCount);
            if (_state.StoredMassKg <= 0.001f) ClearStoredWater();
            Debug.Log(string.Format(CultureInfo.InvariantCulture,
                "[DoubaoAI][WaterSkill] particles-confirmed operation=spray cell={0} actualKg={1:R} storedKg={2:R}",
                targetCell, actual, _state.StoredMassKg));
            Finish(Success(string.Format(CultureInfo.InvariantCulture,
                "噗——已喷出 {0:0.#} kg {1}，还剩 {2:0.#} kg。真实液滴会按游戏重力下落、碰撞并积水。",
                amount, stored.name, _state.StoredMassKg)),
                new WaterTransferFeedback(false, targetCell, amount, stored.id));
        }

        private static bool HasSafeParticleFootprint(int cell)
        {
            Grid.CellToXY(cell, out int x, out int y);
            for (int dx = -2; dx <= 2; dx++)
            for (int dy = -2; dy <= 3; dy++)
            {
                int nearby = Grid.OffsetCell(cell, dx, dy);
                if (!Grid.IsValidCell(nearby) || Grid.WorldIdx[nearby] != Grid.WorldIdx[cell]) return false;
                Grid.CellToXY(nearby, out int nx, out int ny);
                if (nx != x + dx || ny != y + dy) return false;
            }
            return true;
        }

        private static double CountNearbyParticles(FallingWater water, int cell, ushort element)
        {
            double mass = 0;
            for (int dx = -2; dx <= 2; dx++)
            for (int dy = -2; dy <= 3; dy++)
            {
                if (water.GetInfo(Grid.OffsetCell(cell, dx, dy)).TryGetValue(element, out float value)) mass += value;
            }
            return mass;
        }

        private static bool ValidMass(float mass) => !float.IsNaN(mass) && !float.IsInfinity(mass) && mass > 0f;

        private PlayerCommandExecutionResult ValidateTransfer(int targetCell, MinionIdentity followedMinion)
        {
            if (_disposed || _persistenceFault) return Failure("储水状态未就绪，暂时不能施法。");
            if (_state.PendingTransfer != null) return Failure("上一次水团术还没有确认结果，暂不重复执行，以免水量错乱。");
            if (Game.Instance == null || SpeedControlScreen.Instance == null)
                return Failure("游戏模拟尚未就绪。");
            if (SpeedControlScreen.Instance.IsPaused) return Failure("游戏现在暂停着，请恢复运行后再让我吸水或喷水。");
            return ValidateTarget(targetCell, followedMinion);
        }

        private bool Begin(string operation, int cell, float mass, Action<PlayerCommandExecutionResult> completed)
        {
            _state.PendingTransfer = string.Format(CultureInfo.InvariantCulture, "{0}:{1}:{2:R}:{3}", operation, cell, mass, Guid.NewGuid());
            if (!Save())
            {
                _state.PendingTransfer = null;
                completed(Failure("无法保存储水记录，这次没有向游戏发送指令。"));
                return false;
            }
            _completion = completed;
            _startedAt = Time.realtimeSinceStartup;
            return true;
        }

        internal void Tick()
        {
            if (_completion != null && Time.realtimeSinceStartup - _startedAt >= 10f)
                Uncertain("游戏尚未确认水团术结果，暂时锁定储水；不会重复执行，请先恢复游戏运行。");
        }

        private void Uncertain(string message)
        {
            var callback = _completion;
            _completion = null;
            Debug.LogWarning("[DoubaoAI][WaterSkill] " + message + " pending=" + _state.PendingTransfer);
            callback?.Invoke(Failure(message));
        }

        private void Finish(PlayerCommandExecutionResult result, WaterTransferFeedback feedback = null)
        {
            _state.PendingTransfer = null;
            if (!Save())
            {
                _persistenceFault = true;
                result = Failure("游戏已返回结果，但储水记录保存失败。已停止后续施法，请保留日志核对。");
            }
            var callback = _completion;
            _completion = null;
            if (result.Success && feedback != null)
            {
                // Visual feedback must never break settlement or prevent the tool reply.
                try { TransferConfirmed?.Invoke(feedback); }
                catch (Exception ex) { Debug.LogWarning("[DoubaoAI][WaterSkill] Feedback failed: " + ex.Message); }
            }
            if (callback != null) callback(result);
            else LateResult?.Invoke(result);
        }

        private void LogResult(string operation, int cell, float before, float actual)
        {
            Debug.Log(string.Format(CultureInfo.InvariantCulture,
                "[DoubaoAI][WaterSkill] sim-confirmed operation={0} cell={1} beforeKg={2:R} actualKg={3:R} observedKg={4:R} observedElement={5} storedKg={6:R}",
                operation, cell, before, actual, Grid.Mass[cell], Grid.Element[cell].id, _state.StoredMassKg));
        }

        internal void Dispose()
        {
            _disposed = true;
            _completion = null;
            // Unresolved intent remains on disk. Never assume a submitted native command was cancelled.
        }

        internal string PromptSummary()
        {
            if (!_state.Learned)
                return "小汤圆技能看板: 水团术未学会；跟随复制人接触至少1kg水后自动觉醒。";
            return string.Format(CultureInfo.InvariantCulture,
                "小汤圆技能看板: 水团术已学会；储水={0:0.#}/{1:0}kg，种类={2}；玩家要求吸水时调用 oni_companion_absorb_water，要求喷水或放水时调用 oni_companion_spray_water。喷水允许空气、真空和其他液体，不要求真空；指着地板会优先使用正上方非实心格。液滴由游戏物理处理，不能因为有空气而拒绝调用。储水仍保留单一水种，喷完可换种类。只根据工具结果汇报成功。",
                _state.StoredMassKg, CapacityKg, StoredElementName);
        }

        private static PlayerCommandExecutionResult ValidateTarget(int targetCell, MinionIdentity followedMinion)
        {
            if (!Grid.IsValidCell(targetCell)) return Failure("鼠标没有指向有效格子。");
            if (followedMinion == null || followedMinion.gameObject == null)
                return Failure("我现在没有可以跟随的复制人。");
            int origin = Grid.PosToCell(followedMinion.gameObject);
            if (!Grid.IsValidCell(origin) || Grid.WorldIdx[origin] != Grid.WorldIdx[targetCell])
                return Failure("目标不在我和搭档所在的世界。");
            Grid.CellToXY(origin, out int originX, out int originY);
            Grid.CellToXY(targetCell, out int targetX, out int targetY);
            if (Math.Abs(originX - targetX) + Math.Abs(originY - targetY) > MaximumRangeCells)
                return Failure("那里太远了，把鼠标移到我附近12格以内吧。");
            return null;
        }

        private static bool IsWater(Element element)
        {
            return element != null && element.IsLiquid && element.HasTag(GameTags.AnyWater);
        }

        private Element StoredElement()
        {
            if (_state.StoredMassKg <= 0.001f || string.IsNullOrWhiteSpace(_state.StoredElementId)) return null;
            if (!Enum.TryParse(_state.StoredElementId, out SimHashes hash)) return null;
            ushort index = ElementLoader.GetElementIndex(hash);
            return index == ushort.MaxValue ? null : ElementLoader.elements[index];
        }

        private void ClearStoredWater()
        {
            _state.StoredElementId = string.Empty;
            _state.StoredMassKg = 0f;
            _state.StoredTemperatureKelvin = 0f;
            _state.StoredDiseaseIndex = byte.MaxValue;
            _state.StoredDiseaseCount = 0;
        }

        private static FairyWaterSkillState Load(string path)
        {
            try
            {
                FairyWaterSkillState state = File.Exists(path)
                    ? JsonConvert.DeserializeObject<FairyWaterSkillState>(File.ReadAllText(path))
                    : null;
                state = state ?? new FairyWaterSkillState();
                state.Normalize(CapacityKg);
                return state;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DoubaoAI][WaterSkill] 读取技能状态失败：" + ex.Message);
                return new FairyWaterSkillState();
            }
        }

        private bool Save()
        {
            try
            {
                _state.Normalize(CapacityKg);
                Directory.CreateDirectory(Path.GetDirectoryName(_statePath));
                string temporary = _statePath + ".tmp";
                File.WriteAllText(temporary, JsonConvert.SerializeObject(_state, Formatting.Indented));
                if (File.Exists(_statePath)) File.Replace(temporary, _statePath, null);
                else File.Move(temporary, _statePath);
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DoubaoAI][WaterSkill] 保存技能状态失败：" + ex.Message);
                return false;
            }
        }

        private static string ResolveStatePath()
        {
            string saveIdentity = "default";
            try
            {
                string raw = SaveLoader.Instance == null
                    ? string.Empty
                    : Convert.ToString(SaveLoader.Instance.GameInfo.colonyGuid, CultureInfo.InvariantCulture);
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    using (SHA256 sha = SHA256.Create())
                    {
                        byte[] digest = sha.ComputeHash(Encoding.UTF8.GetBytes("oni-water-skill:" + raw));
                        saveIdentity = BitConverter.ToString(digest).Replace("-", string.Empty).ToLowerInvariant();
                    }
                }
            }
            catch { /* fall back to a default state for non-save test scenes */ }
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "XiaoTangYuan", "oni-state");
            return Path.Combine(root, saveIdentity + ".water-skill.json");
        }

        private static PlayerCommandExecutionResult Success(string reply)
        {
            return new PlayerCommandExecutionResult { Success = true, Reply = reply };
        }

        private static PlayerCommandExecutionResult Failure(string reply)
        {
            return new PlayerCommandExecutionResult { Success = false, Reply = reply };
        }
    }
}
