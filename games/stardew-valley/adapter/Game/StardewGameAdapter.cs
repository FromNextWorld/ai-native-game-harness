using System;
using System.Collections.Generic;
using System.Text.Json;
using StardewAgentMod.Game.Abilities;
using StardewAgentMod.Game.Actions;
using StardewAgentMod.Game.Companion;
using StardewAgentMod.Game.Combat;
using System.Linq;
using StardewAgentMod.Game.Flight;
using StardewAgentMod.Harness;
using StardewModdingAPI;
using StardewValley;

namespace StardewAgentMod.Game;

/// <summary>
/// Adapter Protocol 1.0 的 Stardew 实现。网络细节由 AdapterProtocolClient 隐藏；
/// 本 Module 只负责声明能力、给出权威观察并在主线程执行动作。
/// </summary>
internal sealed class StardewGameAdapter : IAdapterProtocolHandler
{
    public const string GameId = "stardew-valley";
    public const string AdapterId = "qimidandapigu.stardew-agent";
    public const string AdapterVersion = "0.8.2";

    private readonly CompanionGrowthSystem growth;
    private readonly AbilityRegistry abilities;
    private readonly CompanionLifeModule companionLife;
    private readonly CompanionStamina stamina;
    private readonly FlightController flight;
    private readonly MineCombatAssist mineCombat;
    private readonly RescueAssist rescue;
    private readonly StardewActionModule actions;
    private readonly ProjectileGroup projectiles;
    private readonly Dictionary<string, object> completed = new(StringComparer.Ordinal);
    private readonly Queue<string> completedOrder = new();

    private string saveId = "title";
    private int revision;

    public StardewGameAdapter(
        CompanionGrowthSystem growth,
        AbilityRegistry abilities,
        CompanionLifeModule companionLife,
        CompanionStamina stamina,
        FlightController flight,
        MineCombatAssist mineCombat,
        RescueAssist rescue,
        StardewActionModule actions,
        ProjectileGroup projectiles)
    {
        this.growth = growth;
        this.abilities = abilities;
        this.companionLife = companionLife;
        this.stamina = stamina;
        this.flight = flight;
        this.mineCombat = mineCombat;
        this.rescue = rescue;
        this.actions = actions;
        this.projectiles = projectiles;
    }

    public void SetSaveId(string? value)
    {
        this.saveId = string.IsNullOrWhiteSpace(value) ? "title" : value.Trim();
        this.revision = 0;
        this.completed.Clear();
        this.completedOrder.Clear();
    }

    public object Hello()
    {
        return new
        {
            protocolVersion = "1.0",
            adapterId = AdapterId,
            gameId = GameId,
            displayName = "Stardew Valley / 星露谷物语",
            adapterVersion = AdapterVersion,
            capabilities = Capabilities.Concat(ProjectileGroup.AtomNames.Select(name => new {
                name, kind = "action", description = "有时限的投射物原子能力，详见游戏聊天通道原子目录。万剑归宗编排由 TS 执行。",
                inputSchema = ProjectileGroup.InputSchema(name),
            })),
        };
    }

    public object Observe()
    {
        object state = Context.IsWorldReady && Game1.player is not null && Game1.currentLocation is not null
            ? GameObservationBuilder.Capture(
                this.growth.GetSnapshot(),
                new CompanionRuntimeSnapshot(
                    this.stamina.Current,
                    CompanionStamina.Max,
                    this.flight.IsAirborne,
                    this.flight.IsTransitioning,
                    this.mineCombat.IsActive,
                    this.rescue.IsActive),
                this.companionLife.GetSnapshot(),
                this.abilities.Snapshot(),
                this.projectiles.CaptureLiveState())
            : new
            {
                schema = "ai-native.game-context.v1",
                meta = new { gameId = GameId, adapterId = AdapterId, locale = "zh-CN" },
                ui = new { worldReady = false },
            };

        return new
        {
            gameId = GameId,
            saveId = this.saveId,
            revision = this.revision,
            observedAt = DateTimeOffset.UtcNow.ToString("O"),
            state,
        };
    }

    public object Execute(JsonElement request)
    {
        string requestId = ReadRequiredString(request, "requestId");
        if (this.completed.TryGetValue(requestId, out object? cached)) return cached;

        string gameId = ReadRequiredString(request, "gameId");
        if (!string.Equals(gameId, GameId, StringComparison.Ordinal))
            return this.Cache(requestId, Failure(requestId, this.revision, "GAME_ID_MISMATCH", $"Expected {GameId}, received {gameId}."));

        string capability = ReadRequiredString(request, "capability");
        int? expectedRevision = ReadOptionalRevision(request);
        if (expectedRevision is not null && expectedRevision.Value != this.revision)
        {
            return this.Cache(requestId, Failure(
                requestId,
                this.revision,
                "REVISION_CONFLICT",
                $"Expected revision {expectedRevision.Value}, current revision is {this.revision}."));
        }

        JsonElement argumentsElement = request.TryGetProperty("arguments", out JsonElement rawArguments)
            ? rawArguments
            : default;
        if (argumentsElement.ValueKind != JsonValueKind.Object)
            return this.Cache(requestId, Failure(requestId, this.revision, "INVALID_ARGUMENTS", "Action arguments must be an object."));

        if (ProjectileGroup.AtomNames.Contains(capability))
        {
            try {
                object receipt = this.projectiles.Execute(capability, argumentsElement);
                if (capability != ProjectileGroup.Prefix + "status") this.revision++;
                // Do not cache a mutable receipt: a duplicate launch response must not become a later success.
                return this.Cache(requestId, JsonSerializer.SerializeToElement(new { requestId, ok = true, revision = this.revision, result = receipt }));
            }
            catch (Exception ex) { return this.Cache(requestId, Failure(requestId, this.revision, "PROJECTILE_REJECTED", ex.Message)); }
        }

        IReadOnlyDictionary<string, object?> arguments = JsonSerializer.Deserialize<Dictionary<string, object?>>(argumentsElement.GetRawText())
            ?? new Dictionary<string, object?>();
        if (capability == "stardew.inspect_planning")
        {
            if (!Context.IsWorldReady) return this.Cache(requestId, Failure(requestId, this.revision, "WORLD_NOT_READY", "请先进入存档。"));
            try { return this.Cache(requestId, new { requestId, ok = true, revision = this.revision, result = PlanningEvidence.Capture(arguments) }); }
            catch (Exception ex) { return this.Cache(requestId, Failure(requestId, this.revision, "INSPECTION_FAILED", ex.Message)); }
        }
        GameActionOutcome outcome = this.actions.Execute(capability, arguments);
        if (outcome.Ok && outcome.ChangedState) this.revision++;

        var result = new Dictionary<string, object?>
        {
            ["requestId"] = requestId,
            ["ok"] = outcome.Ok,
            ["revision"] = this.revision,
            ["result"] = outcome.Result,
            ["timing"] = new Dictionary<string, object?>
            {
                ["gameExecutionMs"] = outcome.GameExecutionMs,
            },
        };
        if (!outcome.Ok)
        {
            result["error"] = new Dictionary<string, object?>
            {
                ["code"] = outcome.ErrorCode ?? "ACTION_REJECTED",
                ["message"] = outcome.Message,
            };
        }
        return this.Cache(requestId, result);
    }

    private object Cache(string requestId, object result)
    {
        this.completed[requestId] = result;
        this.completedOrder.Enqueue(requestId);
        while (this.completedOrder.Count > 128)
            this.completed.Remove(this.completedOrder.Dequeue());
        return result;
    }

    private static object Failure(string requestId, int revision, string code, string message)
    {
        return new
        {
            requestId,
            ok = false,
            revision,
            error = new { code, message },
        };
    }

    private static string ReadRequiredString(JsonElement source, string name)
    {
        if (source.ValueKind != JsonValueKind.Object
            || !source.TryGetProperty(name, out JsonElement value)
            || value.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new InvalidOperationException($"{name} must be a non-empty string.");
        }
        return value.GetString()!;
    }

    private static int? ReadOptionalRevision(JsonElement source)
    {
        if (!source.TryGetProperty("expectedRevision", out JsonElement value)) return null;
        if (!value.TryGetInt32(out int revision) || revision < 0)
            throw new InvalidOperationException("expectedRevision must be a non-negative integer.");
        return revision;
    }

    private static readonly object EmptyInputSchema = new
    {
        type = "object",
        additionalProperties = false,
        properties = new Dictionary<string, object>(),
    };

    private static readonly object[] Capabilities =
    {
        Observation("game.state", "当前星露谷存档、玩家、农场、同伴与 UI 的权威观察。"),
        new { name = "stardew.inspect_planning", kind = "action", description = "只读查询存档事实：npc 查角色位置，route 同时查地图出口，inventory 查背包、献祭进度和交物任务，day 查身体状态、任务、明日天气和工具升级。不得把条件路线当成已验通路线，不自动出售。", inputSchema = new {
            type = "object", additionalProperties = false, required = new[] { "kind" }, properties = new Dictionary<string, object> {
                ["kind"] = new { type = "string", @enum = new[] { "npc", "route", "inventory", "day" } }, ["npc"] = new { type = "string" },
            } } },
        Action(StardewCapabilities.PlantSeedsAll, "把玩家当前选中的种子播到当前地图可用农田；遵守游戏可种植规则。"),
        Action(StardewCapabilities.WaterAll, "浇灌指定矩形区域干燥耕地与花盆。指定区域必须传 location/x/y/width/height；只有玩家明确要求整个地图时才传空参数。区域不明确先询问，禁止猜坐标。"),
        Action(StardewCapabilities.HarvestAll, "收获指定矩形区域成熟作物，保留未成熟作物。指定区域必须传 location/x/y/width/height；只有玩家明确要求整个地图时才传空参数。区域不明确先询问，禁止猜坐标。"),
        Action(StardewCapabilities.SpeedGrow, "把当前地图未成熟作物推进到睡一夜后可收获，并补水。"),
        Action(StardewCapabilities.ClearDebris, "清理玩家周围八格的农场天然杂物；保护作物、设施、果树、茶树和装有树液采集器的树。"),
        Action(StardewCapabilities.FlightTakeoff, "在允许的室外主地图让玩家乘小汤圆起飞。"),
        Action(StardewCapabilities.FlightLand, "寻找附近安全地块并让玩家缓慢降落。"),
        Action(StardewCapabilities.FishHelp, "挂起一次钓鱼协助，在下一次钓鱼小游戏中自动完美收杆。"),
        Action(StardewCapabilities.MineCombat, "开启约十秒的近身矿洞战斗协助。"),
        Action(StardewCapabilities.RescueHome, "凌晨时把玩家安全送到床边并进入原版睡眠流程。"),
    };

    private static object Observation(string name, string description) => new
    {
        name,
        kind = "observation",
        description,
    };

    private static object Action(string name, string description) => new
    {
        name,
        kind = "action",
        description,
        inputSchema = name is StardewCapabilities.WaterAll or StardewCapabilities.HarvestAll ? FieldInputSchema : EmptyInputSchema,
    };

    private static object FieldInputSchema => new
    {
        type = "object", additionalProperties = false,
        properties = new Dictionary<string, object>
        {
            ["location"] = new { type = "string", description = "当前观察中的地图唯一名称" },
            ["x"] = new { type = "integer", minimum = 0, maximum = 10000 },
            ["y"] = new { type = "integer", minimum = 0, maximum = 10000 },
            ["width"] = new { type = "integer", minimum = 1, maximum = 64 },
            ["height"] = new { type = "integer", minimum = 1, maximum = 64 },
        },
    };
}

internal sealed record CompanionRuntimeSnapshot(
    int Stamina,
    int StaminaMax,
    bool IsAirborne,
    bool IsFlightTransitioning,
    bool IsCombatAssistActive,
    bool IsRescueActive
);
