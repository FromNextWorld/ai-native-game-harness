using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewAgentMod.Game.Abilities;
using StardewAgentMod.Game.Companion;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Monsters;
using NVector = System.Numerics.Vector2;

namespace StardewAgentMod.Game.Combat;

/// <summary>
/// Native bounded projectile groups. TS chooses when to orbit, form and launch.
/// Single-player only until authority + visual replication is implemented.
/// Every receipt records real health deltas, never infers a kill from a VFX.
/// </summary>
internal sealed class ProjectileGroup
{
    public const string Prefix = "stardew.projectiles_";
    public static readonly string[] AtomNames = { Prefix + "create", Prefix + "formation", Prefix + "launch", Prefix + "status", Prefix + "cancel" };
    public static readonly object[] AtomDefinitions = {
        new { name = Prefix + "create", description = "创建有时限的本地演出。preview=true 无伤；resource=chop/fish/water 为资源作业且preview=false。可接续未发射无伤组，不延长原60秒。砍树可指定每崽最多24次原生斧击和最多8个目标；捕鱼可指定最多8次原生抽取；按实际成果计数，单人，作业1体力。", parameters = "{opId:string,count:integer(1..12),preview:boolean,resource?:'chop'|'fish'|'water',replacePreviewOpId?:string,impactsPerProjectile?:integer(1..24),targetLimit?:integer(1..8),fishRollLimit?:integer(1..8)}", returns = "{opId,state,preview,count,hits,damage,kills,remaining,reason,resource,resources,impactsPerProjectile,targetLimit,targetsSelected,targetsCompleted,fishRollLimit}" },
        new { name = Prefix + "formation", description = "设置已有组的环绕或扇形阵型，不发射、不结算伤害。", parameters = "{opId:string,formation:'orbit'|'fan'}", returns = "组状态；不是命中成功" },
        new { name = Prefix + "launch", description = "将投射物分批射向当前附近存活怪物；仅真实命中后由原版结算伤害。preview 组射向空地，不碰游戏实体。", parameters = "{opId:string,spacingMs:integer(60..250)}", returns = "组状态；state=launched 仅表示开始" },
        new { name = Prefix + "status", description = "省略 opId 读取当前组用于条件接续，无当前组返回idle；带opId读历史回执。live字段始终是与画面一致的当前状态及冷却剩余毫秒，不把旧回执当作仍在施放。", parameters = "{opId?:string}", returns = "{opId,state,preview,count,hits,damage,kills,remaining,reason,resource,resources,live} 或 {state:'idle',remaining:0,live}" },
        new { name = Prefix + "cancel", description = "立即撤销本地投射物组，既往伤害不回滚。省略 opId 取消当前组；可取消尚未创建的 opId 防止迟到动作。", parameters = "{opId?:string}", returns = "终态 canceled 或已有终态" },
    };

    public static object InputSchema(string name)
    {
        var properties = new Dictionary<string, object> { ["opId"] = new { type = "string", format = "uuid" } };
        var required = new List<string> { "opId" };
        if (name == Prefix + "create") {
            properties["count"] = new { type = "integer", minimum = 1, maximum = 12 };
            properties["preview"] = new { type = "boolean", description = "true 演示不伤怪，false 实战" };
            properties["resource"] = new { type = "string", @enum = new[] { "chop", "fish", "water" }, description = "可选资源作业；water 为幽灵爷爷浇地，必须 preview=false" };
            properties["replacePreviewOpId"] = new { type = "string", format = "uuid", description = "仅接续此UUID的未发射无伤组；目标先验失败不改变原组" };
            properties["impactsPerProjectile"] = new { type = "integer", minimum = 1, maximum = 24, description = "仅chop：每个投射物最多连续斧击次数；目标完成即停，每帧至多一次" };
            properties["targetLimit"] = new { type = "integer", minimum = 1, maximum = 8, description = "仅chop：本次最多选择的目标数，不代表已砍倒数" };
            properties["fishRollLimit"] = new { type = "integer", minimum = 1, maximum = 8, description = "仅fish：原生抽取次数上限，省略为3，不保证出鱼" };
            required.AddRange(new[] { "count", "preview" });
        }
        if (name == Prefix + "formation") { properties["formation"] = new { type = "string", @enum = new[] { "orbit", "fan" } }; required.Add("formation"); }
        if (name == Prefix + "launch") { properties["spacingMs"] = new { type = "integer", minimum = 60, maximum = 250 }; required.Add("spacingMs"); }
        if (name == Prefix + "cancel" || name == Prefix + "status") required.Clear();
        return new { type = "object", additionalProperties = false, required, properties };
    }

    private readonly Func<Vector2?> anchor;
    private readonly Func<bool> blocked;
    private readonly AbilityRegistry abilities;
    private readonly CompanionStamina stamina;
    private readonly IMonitor monitor;
    private readonly Func<DateTimeOffset> now;
    private readonly ProjectileRenderer renderer = new();
    private readonly Dictionary<string, Receipt> history = new(StringComparer.Ordinal);
    private readonly Queue<string> order = new();
    private readonly List<Shot> shots = new();
    private Receipt? current;
    private GameLocation? location;
    private long owner;
    private DateTimeOffset expires;
    private DateTimeOffset cooldown;
    private bool hasActivity;
    private string lastResource = "";
    private float elapsed;
    private float launchElapsed;
    private int spacingMs;
    private string formation = "orbit";
    internal sealed record ResourceTarget(Vector2 Position, Func<int> Apply, Func<bool>? IsCompleted = null);
    private readonly Func<string, List<ResourceTarget>> resourceFinder;
    private List<ResourceTarget> resourceTargets = new();
    private readonly HashSet<ResourceTarget> completedTargets = new();
    private readonly GrandpaRenderer grandpaRenderer = new();
    private float returningSince = -1;
    private Vector2? waterVisual;
    private Vector2 waterOrigin;
    private (Vector2 Origin, GameLocation Location, DateTimeOffset Started)? farewell;
    // Pure render tail: never keeps a live shot, target, resource callback or receipt open.
    private SwordReturn? swordReturn;
    private sealed record SwordReturn(Vector2[] From, GameLocation Location, long Owner, DateTimeOffset Started);
    internal Vector2 WaterOrigin => this.waterOrigin;
    internal bool HasFarewell => this.farewell != null;

    public ProjectileGroup(Func<Vector2?> anchor, Func<bool> blocked, AbilityRegistry abilities, CompanionStamina stamina, IMonitor monitor, Func<DateTimeOffset>? now = null, Func<string, List<ResourceTarget>>? resourceFinder = null)
    {
        this.anchor = anchor; this.blocked = blocked; this.abilities = abilities; this.stamina = stamina; this.monitor = monitor;
        this.now = now ?? (() => DateTimeOffset.UtcNow);
        this.resourceFinder = resourceFinder ?? (_ => new());
    }

    public object Execute(string atom, JsonElement args)
    {
        object result = this.ExecuteCore(atom, args);
        // Historical evidence stays historical; attach a fresh, separate snapshot on every read.
        if (result is Receipt receipt) receipt.live = this.CaptureLiveState();
        return result;
    }

    private object ExecuteCore(string atom, JsonElement args)
    {
        if (!AtomNames.Contains(atom)) throw new InvalidOperationException("未声明的投射物原子能力。");
        if (args.ValueKind != JsonValueKind.Object) throw new ArgumentException("参数必须是对象。");
        string action = atom.Substring(Prefix.Length);
        string[] allowed = action switch {
            "create" => new[] { "opId", "count", "preview", "resource", "replacePreviewOpId", "impactsPerProjectile", "targetLimit", "fishRollLimit" }, "formation" => new[] { "opId", "formation" },
            "launch" => new[] { "opId", "spacingMs" }, _ => new[] { "opId" },
        };
        if (args.EnumerateObject().Any(p => !allowed.Contains(p.Name))) throw new ArgumentException("存在未支持的参数。");
        if (args.TryGetProperty("opId", out var providedId) && providedId.ValueKind != JsonValueKind.String) throw new ArgumentException("opId 必须为 UUID 字符串。");
        string? id = args.TryGetProperty("opId", out var idValue) && idValue.ValueKind == JsonValueKind.String ? idValue.GetString() : null;
        if (id == null && action == "status" && !args.TryGetProperty("opId", out _)) {
            this.RefreshState();
            return this.current is { } active ? active : new { state = "idle", remaining = 0, live = this.CaptureLiveState() };
        }
        if (id == null && action == "cancel" && !args.TryGetProperty("opId", out _)) {
            this.RefreshState();
            this.hasActivity = true;
            id = this.current?.opId;
            // Reject late creations from a just-canceled voice/model turn.
            if (this.cooldown < this.now().AddSeconds(3)) this.cooldown = this.now().AddSeconds(3);
        }
        if (id == null && action == "cancel") return new { state = "idle", remaining = 0, live = this.CaptureLiveState() };
        if (!Guid.TryParseExact(id, "D", out _)) throw new ArgumentException("opId 必须为 UUID。");
        if (action == "cancel")
        {
            if (this.current?.opId == id) {
                if (this.current.resource == "water" && this.location != null)
                    this.farewell = (this.waterOrigin, this.location, this.now());
                this.Finish("canceled", "作业已停止；剩余动画不再改变游戏状态。", showSwordReturn: true);
            }
            if (!this.history.TryGetValue(id!, out var canceled)) { canceled = new Receipt(id!, 0, true) { state = "canceled", reason = "已封存取消请求，迟到的创建不会执行。" }; this.Remember(canceled); }
            return canceled;
        }
        if (action == "status")
        {
            this.CheckLifetime();
            return this.history.TryGetValue(id!, out var status) ? status : throw new InvalidOperationException("找不到这个投射物组；不能当作完成。");
        }
        if (action == "create") return this.Create(id!, args);
        this.CheckLifetime();
        if (this.current?.opId != id) throw new InvalidOperationException("这个投射物组已经结束或不存在。");
        this.RequireWorld();
        if (action == "formation")
        {
            string? next = args.TryGetProperty("formation", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            if (next is not "orbit" and not "fan") throw new ArgumentException("阵型只能是 orbit 或 fan。");
            if (this.current.state == "launched") throw new InvalidOperationException("发射后不能改变阵型。");
            this.formation = next;
            this.current.state = next;
        }
        else if (action == "launch")
        {
            int spacing = ReadInt(args, "spacingMs");
            if (spacing < 60 || spacing > 250) throw new ArgumentException("发射间隔需为 60 到 250 毫秒。");
            if (this.current.state == "launched") return this.current; // duplicate launch cannot restart damage
            if (!this.current.preview && this.current.resource == "" && this.Targets().Count == 0) { this.Finish("failed", "附近没有可攻击的怪物。"); return this.history[id!]; }
            if (!this.current.preview && this.current.resource == "")
            {
                var check = this.abilities.CanUseIntent(AbilityRegistry.MineCombat);
                if (!check.Allowed) { this.Finish("failed", check.ReasonLine); return this.history[id!]; }
            }
            this.spacingMs = spacing;
            this.launchElapsed = this.elapsed;
            this.current.state = "launched";
        }
        return this.current!;
    }

    private Receipt Create(string id, JsonElement args)
    {
        int count = ReadInt(args, "count"); ProjectileGeometry.ValidateCount(count);
        if (!args.TryGetProperty("preview", out var previewValue) || previewValue.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
            throw new ArgumentException("必须明确指定 preview=true 或 false。");
        bool preview = previewValue.GetBoolean();
        string resource = args.TryGetProperty("resource", out var rv) && rv.ValueKind == JsonValueKind.String ? rv.GetString()! : "";
        if (args.TryGetProperty("resource", out _) && resource is not "chop" and not "fish" and not "water") throw new ArgumentException("资源模式只能是 chop/fish/water。");
        if (resource != "" && preview) throw new ArgumentException("资源作业不能标记为无伤预览。");
        bool boundedImpacts = args.TryGetProperty("impactsPerProjectile", out _) || args.TryGetProperty("targetLimit", out _);
        int impacts = 1, targetLimit = 12;
        if (boundedImpacts) {
            if (resource != "chop") throw new ArgumentException("连续斧击参数仅支持砍树，不能增加捕鱼或战斗次数。");
            impacts = args.TryGetProperty("impactsPerProjectile", out _) ? ReadInt(args, "impactsPerProjectile") : 1;
            targetLimit = args.TryGetProperty("targetLimit", out _) ? ReadInt(args, "targetLimit") : 4;
            if (impacts < 1 || impacts > 24 || targetLimit < 1 || targetLimit > 8) throw new ArgumentException("每崽斧击上限1到24次，目标上限1到8个。");
        }
        int fishRollLimit = 3;
        if (args.TryGetProperty("fishRollLimit", out _)) {
            if (resource != "fish") throw new ArgumentException("捕鱼次数参数仅支持捕鱼。");
            fishRollLimit = ReadInt(args, "fishRollLimit");
            if (fishRollLimit < 1 || fishRollLimit > 8) throw new ArgumentException("捕鱼抽取上限1到8次。");
        }
        string? replacing = null;
        if (args.TryGetProperty("replacePreviewOpId", out var replacement)) {
            if (replacement.ValueKind != JsonValueKind.String || !Guid.TryParseExact(replacement.GetString(), "D", out _))
                throw new ArgumentException("replacePreviewOpId 必须为 UUID。");
            replacing = replacement.GetString();
        }
        if (this.history.TryGetValue(id, out var old)) return old;
        this.RefreshState();
        this.RequireWorld();
        if (replacing != null) {
            if (this.current?.opId != replacing || !this.current.preview || this.current.resource != ""
                || this.current.state is not "orbit" and not "fan" || id == replacing
                || this.location != Game1.currentLocation || this.owner != Game1.player.UniqueMultiplayerID)
                throw new InvalidOperationException("刚才的环绕剑阵已变化或已出击，请重新下令；没有替换其他作业。");
        } else {
            var live = this.CaptureLiveState();
            if (live.active) throw new InvalidOperationException($"{live.screenLabel}。请先停止当前作业。");
            if (live.cooldownRemainingMs > 0) throw new InvalidOperationException($"{live.screenLabel}。请等倒计时结束。");
        }
        // Load the real companion texture before changing state or spending stamina.
        this.renderer.Prepare();
        if (resource == "water") this.grandpaRenderer.Prepare();
        var nextTargets = resource == "" ? new List<ResourceTarget>() : this.resourceFinder(resource);
        if (boundedImpacts) {
            nextTargets = nextTargets.Take(targetLimit).ToList();
            if (nextTargets.Any(t => t.IsCompleted == null)) throw new InvalidOperationException("目标缺少真实完成状态，不能执行连续斧击。");
        }
        if (resource != "" && nextTargets.Count == 0) throw new InvalidOperationException("附近没有符合条件的作业目标（普通成年树、水面或干燥耕地）。");
        if (resource != "" && !this.stamina.TrySpend()) throw new InvalidOperationException("小汤圆体力不足。");
        if (!preview && resource == "")
        {
            var check = this.abilities.CanUseIntent(AbilityRegistry.MineCombat);
            if (!check.Allowed) throw new InvalidOperationException(check.ReasonLine);
            if (this.Targets().Count == 0) throw new InvalidOperationException("附近没有可攻击的怪物；可改用演示模式。");
            if (!this.stamina.TrySpend()) throw new InvalidOperationException("小汤圆体力不足。");
            this.abilities.NoteUsed(AbilityRegistry.MineCombat);
        }
        // Only after every preflight succeeds: atomically retire the harmless
        // receipt and activate its successor. Never cancel/recreate through cooldown.
        var nextExpiry = replacing == null ? this.now().AddSeconds(ProjectileGeometry.LifetimeSeconds) : this.expires;
        float nextElapsed = replacing == null ? 0 : this.elapsed;
        if (replacing != null) { this.current!.state = "canceled"; this.current.remaining = 0; this.current.reason = "环绕组已交接到后续作业。"; }
        this.resourceTargets = nextTargets;
        this.completedTargets.Clear();
        this.current = new Receipt(id, count, preview);
        this.hasActivity = true; this.lastResource = resource;
        this.current.resource = resource;
        this.current.impactsPerProjectile = impacts; this.current.targetLimit = targetLimit; this.current.targetsSelected = nextTargets.Count;
        this.current.fishRollLimit = fishRollLimit;
        this.location = Game1.currentLocation;
        this.owner = Game1.player.UniqueMultiplayerID;
        this.expires = nextExpiry;
        this.cooldown = this.now().AddSeconds(8);
        this.elapsed = nextElapsed; this.formation = "orbit"; this.shots.Clear(); this.returningSince = -1; this.waterVisual = null;
        Vector2 center = this.anchor()!.Value;
        // Keep the whole grandpa/door/water performance clearly above-right of the companion.
        this.waterOrigin = center + new Vector2(96, -56);
        this.farewell = null;
        this.swordReturn = null;
        for (int i = 0; i < count; i++) {
            var offset = ProjectileGeometry.Offset(i, count, "orbit", this.elapsed);
            var direction = ProjectileGeometry.Facing(i, count, "orbit", this.elapsed);
            this.shots.Add(new Shot { Position = center + new Vector2(offset.X, offset.Y), Direction = new Vector2(direction.X, direction.Y) });
        }
        this.Remember(this.current);
        return this.current;
    }

    private void RequireWorld()
    {
        if (!Context.IsWorldReady || Game1.currentLocation == null || Game1.player == null) throw new InvalidOperationException("请先进入存档。");
        if (Context.IsMultiplayer || !Context.IsMainPlayer) throw new InvalidOperationException("崽崽剑阵首版仅支持单人存档，联机尚未接入同步。");
        if (!Game1.shouldTimePass() || Game1.eventUp || Game1.activeClickableMenu != null || Game1.player.health <= 0 || this.blocked())
            throw new InvalidOperationException("请先关闭菜单、结束事件或飞行，再施放剑阵。");
        if (this.anchor() == null) throw new InvalidOperationException("没有找到小汤圆，请先启用同伴。");
    }

    public void Update()
    {
        this.RefreshState();
        if (this.current == null) return;
        try
        {
            this.RequireWorld();
            if (!ReferenceEquals(Game1.currentLocation, this.location) || Game1.player.UniqueMultiplayerID != this.owner) { this.Finish("canceled", "地图或玩家已变化。"); return; }
            this.UpdateActive();
        }
        catch (Exception ex) { this.Finish("canceled", ex.Message); this.monitor.Log($"[投射物] 已停止：{ex.Message}", LogLevel.Trace); }
    }

    // Render, observation and actions all advance the same bounded lifecycle, even when
    // they run before the next Update. Reading status never starts an action or spends stamina.
    private void RefreshState()
    {
        this.PruneSwordReturn();
        if (this.farewell is { } tail) {
            if ((this.now() - tail.Started).TotalSeconds >= 1 || !Context.IsWorldReady
                || !ReferenceEquals(Game1.currentLocation, tail.Location) || Game1.player.health <= 0
                || Game1.activeClickableMenu != null || Game1.eventUp || this.blocked() || this.anchor() == null)
                this.farewell = null;
        }
        this.CheckLifetime();
        if (this.current != null && (this.location == null || !this.CanShowSwordReturn(this.location, this.owner)))
            this.Cancel("当前场景已不允许继续作业。");
    }

    private void UpdateActive()
    {
            if (this.current == null) return;
            float dt = Math.Clamp((float)(Game1.currentGameTime?.ElapsedGameTime.TotalSeconds ?? 0), 0, 0.05f);
            this.elapsed += dt;
            Vector2 center = this.anchor()!.Value;
            if (this.current.resource != "") { this.UpdateResources(center, dt); return; }
            var frameTargets = this.current.preview ? new List<Monster>() : this.Targets();
            for (int i = 0; i < this.shots.Count; i++)
            {
                Shot shot = this.shots[i];
                if (shot.Done) continue;
                if (this.current.state != "launched" || this.elapsed - this.launchElapsed < i * this.spacingMs / 1000f)
                {
                    var offset = ProjectileGeometry.Offset(i, this.shots.Count, this.formation, this.elapsed);
                    var facing = ProjectileGeometry.Facing(i, this.shots.Count, this.formation, this.elapsed);
                    shot.Position = center + new Vector2(offset.X, offset.Y); shot.Direction = new Vector2(facing.X, facing.Y);
                    continue;
                }
                if (!shot.Fired)
                {
                    shot.Fired = true; shot.Started = this.elapsed;
                    var alive = frameTargets.Where(m => m.Health > 0).ToArray();
                    shot.Target = alive.Length == 0 ? null : alive[i % alive.Length];
                    // Harmless demonstration keeps the staging lanes parallel.
                    // Real combat still steers to the current monster below.
                    shot.Destination = shot.Position + new Vector2(280, -90);
                }
                if (this.elapsed - shot.Started > 2.5f || (!this.current.preview && (shot.Target == null || shot.Target.Health <= 0 || !frameTargets.Contains(shot.Target)))) { shot.Done = true; continue; }
                Vector2 target = this.current.preview ? shot.Destination : new Vector2(shot.Target!.GetBoundingBox().Center.X, shot.Target.GetBoundingBox().Center.Y);
                Vector2 previous = shot.Position;
                var next = ProjectileGeometry.Advance(ToN(previous), ToN(target), dt);
                shot.Position = new Vector2(next.X, next.Y); shot.Direction = target - previous;
                if (!this.current.preview && this.CrossesWall(previous, shot.Position)) { shot.Done = true; continue; }
                shot.Trail.Enqueue(previous); while (shot.Trail.Count > 7) shot.Trail.Dequeue();
                if (this.current.preview)
                {
                    if (Vector2.DistanceSquared(shot.Position, target) < 16) { shot.Done = true; shot.Impact = this.elapsed; }
                    continue;
                }
                var box = shot.Target!.GetBoundingBox();
                if (!ProjectileGeometry.Intersects(ToN(previous), next, box.Left, box.Top, box.Right, box.Bottom)) continue;
                shot.Done = true; // one attempt per projectile, including an invulnerable target
                var contact = new Rectangle((int)Math.Clamp(shot.Position.X, box.Left + 1, box.Right - 1) - 2,
                    (int)Math.Clamp(shot.Position.Y, box.Top + 1, box.Bottom - 1) - 2, 4, 4);
                var before = this.location!.characters.OfType<Monster>().Where(m => m.Health > 0 && m.GetBoundingBox().Intersects(contact))
                    .Select(m => (Monster: m, Health: m.Health)).ToArray();
                // Native damage API preserves farmer attribution, death hooks and loot. Only a
                // confirmed overlap invokes it; nearby NPCs/crops are never passed to damage APIs.
                this.location!.damageMonster(contact, 40, 40, false, Game1.player, isProjectile: true);
                int loss = before.Sum(m => Math.Max(0, m.Health - Math.Max(0, m.Monster.Health)));
                if (loss > 0) {
                    this.current.hits++; this.current.damage += loss;
                    this.current.kills += before.Count(m => m.Monster.Health <= 0); shot.Impact = this.elapsed;
                }
            }
            this.current.remaining = this.shots.Count(s => !s.Done);
            if (this.current.remaining == 0 && this.shots.All(s => s.Impact < 0 || this.elapsed - s.Impact > 0.25f)) this.Finish("completed", "投射物已清理；命中与伤害以计数为准。", showSwordReturn: true);
    }

    private List<Monster> Targets() => !Context.IsWorldReady ? new() : Game1.currentLocation.characters.OfType<Monster>()
        .Where(m => m.Health > 0 && Vector2.DistanceSquared(m.Position, Game1.player.Position) <= 512 * 512)
        .OrderBy(m => Vector2.DistanceSquared(m.Position, Game1.player.Position)).Take(24).ToList();

    private void UpdateResources(Vector2 center, float dt)
    {
        if (this.current!.resource == "water") { this.UpdateWater(); return; }
        for (int i = 0; i < this.shots.Count; i++) {
            var shot = this.shots[i];
            if (shot.Done) continue;
            if (this.current!.state != "launched" || this.elapsed - this.launchElapsed < i * this.spacingMs / 1000f) {
                var offset = ProjectileGeometry.Offset(i, this.shots.Count, this.formation, this.elapsed);
                var facing = ProjectileGeometry.Facing(i, this.shots.Count, this.formation, this.elapsed);
                shot.Position = center + new Vector2(offset.X, offset.Y); shot.Direction = new Vector2(facing.X, facing.Y); continue;
            }
            // Fishing is capped at three rolls; chopping can strike the same tree several times.
            if (this.current.resource == "fish" && i >= this.current.fishRollLimit) { shot.Done = true; continue; }
            var target = this.resourceTargets[i % this.resourceTargets.Count];
            if (target.IsCompleted?.Invoke() == true) { shot.Done = true; continue; }
            if (Vector2.DistanceSquared(target.Position, Game1.player.Position) > 384 * 384) { shot.Done = true; continue; }
            var previous = shot.Position;
            var next = ProjectileGeometry.Advance(ToN(previous), ToN(target.Position), dt);
            shot.Position = new Vector2(next.X, next.Y);
            if (Vector2.DistanceSquared(previous, target.Position) > .001f) shot.Direction = target.Position - previous;
            if (this.current.resource == "chop" && this.CrossesWall(previous, shot.Position)) { shot.Done = true; continue; }
            shot.Trail.Enqueue(previous); while (shot.Trail.Count > 7) shot.Trail.Dequeue();
            if (Vector2.DistanceSquared(shot.Position, target.Position) >= 16) continue;
            if (this.elapsed < shot.NextImpact) continue;
            int effect = target.Apply();
            shot.Impacts++; shot.Impact = this.elapsed; shot.NextImpact = this.elapsed + .08f;
            this.current.resources += effect;
            // Credit a completed target only on the impact which really caused
            // its state transition. Other babies cannot count it again.
            if (effect > 0 && target.IsCompleted?.Invoke() == true && this.completedTargets.Add(target)) this.current.targetsCompleted++;
            shot.Done = effect == 0 || target.IsCompleted?.Invoke() == true || shot.Impacts >= this.current.impactsPerProjectile;
        }
        this.current!.remaining = this.shots.Count(s => !s.Done);
        if (this.current.remaining == 0) this.Finish("completed", "资源作业结束；resources为有效斧击/鱼数，targetsCompleted为本次实际完成的目标数，不表示物品已入包。", showSwordReturn: true);
    }

    private void UpdateWater()
    {
        if (this.current!.state != "launched") return;
        if (this.returningSince >= 0) {
            if (this.elapsed - this.returningSince >= 1) this.Finish("completed", "爷爷已回桥；resources 为实际由干变湿的耕地数量。");
            return;
        }
        int limit = Math.Min(this.shots.Count, this.resourceTargets.Count);
        int index = (int)((this.elapsed - this.launchElapsed) / .40f);
        this.waterVisual = index < limit ? this.resourceTargets[index].Position : null;
        for (int i = 0; i < limit && i < index; i++) {
            if (this.shots[i].Done) continue;
            this.shots[i].Done = true;
            if (Vector2.DistanceSquared(this.resourceTargets[i].Position, Game1.player.Position) <= 384 * 384)
                this.current.resources += this.resourceTargets[i].Apply();
        }
        this.current.remaining = Math.Max(0, limit - Math.Min(index, limit));
        if (index >= limit) { this.returningSince = this.elapsed; this.waterVisual = null; }
    }

    private bool CrossesWall(Vector2 from, Vector2 to)
    {
        var layer = this.location!.Map.GetLayer("Buildings");
        if (layer == null) return false;
        int steps = Math.Max(1, (int)Math.Ceiling(Vector2.Distance(from, to) / 8));
        for (int i = 0; i <= steps; i++) {
            Vector2 point = Vector2.Lerp(from, to, i / (float)steps);
            int x = (int)Math.Floor(point.X / Game1.tileSize), y = (int)Math.Floor(point.Y / Game1.tileSize);
            if (x < 0 || y < 0 || x >= layer.LayerWidth || y >= layer.LayerHeight) return true;
            if (layer.Tiles[x, y] != null && this.location.doesTileHaveProperty(x, y, "Passable", "Buildings") == null) return true;
        }
        return false;
    }

    private void CheckLifetime()
    {
        if (this.current != null && this.now() >= this.expires) this.Finish("expired", "施放超时，已清理全部分身。");
    }

    public void Cancel(string reason) { this.farewell = null; this.swordReturn = null; this.Finish("canceled", reason); }
    public void Reset() { this.Cancel("已离开存档。"); this.history.Clear(); this.order.Clear(); this.cooldown = default; this.hasActivity = false; this.lastResource = ""; }
    private void Finish(string state, string reason, bool showSwordReturn = false)
    {
        if (showSwordReturn && this.current != null && this.current.resource != "water" && this.location != null
            && this.shots.Count > 0 && this.CanShowSwordReturn(this.location, this.owner))
            this.swordReturn = new(this.shots.Select(s => s.Position).ToArray(), this.location, this.owner, this.now());
        if (this.current != null) { this.current.state = state; this.current.reason = reason; this.current.remaining = 0; }
        this.current = null; this.shots.Clear(); this.location = null;
    }
    private void Remember(Receipt receipt)
    {
        this.history[receipt.opId] = receipt; this.order.Enqueue(receipt.opId);
        while (this.order.Count > 64) this.history.Remove(this.order.Dequeue());
    }
    public void Draw(SpriteBatch batch)
    {
        var live = this.CaptureLiveState();
        this.DrawLiveStatus(batch, live);
        if (this.swordReturn is { } returning) {
            Vector2 center = this.anchor()!.Value;
            for (int i = 0; i < returning.From.Length; i++) {
                var offset = ProjectileGeometry.Offset(i, returning.From.Length, "orbit", 0);
                var slot = new Vector2(offset.X, offset.Y);
                Vector2 position = this.ReturnPosition(returning, i, live.capturedAt);
                Vector2 outward = position - center;
                // Body uses its assigned ring view; the single blade points away from
                // the CURRENT mascot position, even before reaching its resting slot.
                this.renderer.Draw(batch, position, outward,
                    Array.Empty<Vector2>(), false, -1, showBack: slot.Y < -0.001f);
            }
        }
        if (this.farewell is { } tail && Context.IsWorldReady && ReferenceEquals(Game1.currentLocation, tail.Location)) {
            float t = (float)(this.now() - tail.Started).TotalSeconds;
            if (t < 1) this.grandpaRenderer.Draw(batch, tail.Origin, t, true, null);
        }
        if (this.current == null) return;
        if (this.current.resource == "water") {
            this.grandpaRenderer.Draw(batch, this.waterOrigin,
                this.returningSince >= 0 ? this.elapsed - this.returningSince : this.elapsed, this.returningSince >= 0, this.waterVisual);
            return;
        }
        foreach (var shot in this.shots) this.renderer.Draw(batch, shot.Position, shot.Direction, shot.Trail, shot.Done, shot.Impact < 0 ? -1 : this.elapsed - shot.Impact);
    }

    private Vector2 ReturnPosition(SwordReturn returning, int index, DateTimeOffset at)
    {
        Vector2 center = this.anchor()!.Value;
        float t = Math.Clamp((float)(at - returning.Started).TotalSeconds / .75f, 0, 1);
        float eased = t * t * (3 - 2 * t);
        var offset = ProjectileGeometry.Offset(index, returning.From.Length, "orbit", 0);
        Vector2 slot = new(offset.X, offset.Y), from = returning.From[index] - center;
        float startAngle = MathF.Atan2(from.Y, from.X), angleDelta = MathF.Atan2(slot.Y, slot.X) - startAngle;
        angleDelta = MathF.Atan2(MathF.Sin(angleDelta), MathF.Cos(angleDelta));
        float angle = startAngle + angleDelta * eased;
        float startRadius = Math.Max(64, MathF.Sqrt(from.LengthSquared()));
        float radius = startRadius + (MathF.Sqrt(slot.LengthSquared()) - startRadius) * eased;
        return center + new Vector2(MathF.Cos(angle), MathF.Sin(angle)) * radius;
    }

    // Visibility describes sword body bounds in the current viewport, not screenshot recognition.
    // Moving offscreen is NOT cancellation. Cosmetic return is NOT active gameplay.
    public LiveState CaptureLiveState()
    {
        this.RefreshState();
        var at = this.now();
        int ms = (int)Math.Max(0, Math.Ceiling((this.cooldown - at).TotalMilliseconds));
        var positions = this.current?.resource == "water" ? new List<Vector2>() : this.shots.Where(s => !s.Done).Select(s => s.Position).ToList();
        if (this.swordReturn is { } tail)
            positions.AddRange(Enumerable.Range(0, tail.From.Length).Select(i => this.ReturnPosition(tail, i, at)));
        int visible = positions.Count(p => new Rectangle((int)p.X - 13, (int)p.Y - 13, 26, 26).Intersects(
            new Rectangle(Game1.viewport.X, Game1.viewport.Y, Game1.viewport.Width, Game1.viewport.Height)));
        bool active = this.current != null;
        bool returning = this.swordReturn != null || this.farewell != null || (active && this.current!.resource == "water" && this.returningSince >= 0);
        string phase = returning ? "returning" : this.current?.state ?? (ms > 0 ? "cooling_down" : "ready");
        string name = this.lastResource == "water" ? "爷爷" : "剑阵";
        string label = returning ? $"{name}收回中" : active
            ? this.current!.resource == "water" ? "爷爷浇地中"
                : $"剑阵{(phase == "launched" ? "出击" : phase == "fan" ? "蓄力" : "环绕")} · {positions.Count} 把"
            : $"{name}{(this.lastResource == "water" ? "未出场" : "未展开")}";
        if (positions.Count > 0 && visible == 0) label += "（屏幕外）";
        if (ms > 0) label += $" · 冷却 {(int)Math.Ceiling(ms / 1000d)} 秒";
        else if (!active && !returning) label += " · 可用";
        // Keep ready state in observations, but do not leave idle text/background on the game screen.
        bool hudVisible = this.hasActivity && (active || returning || ms > 0) && Context.IsWorldReady && Game1.player != null && Game1.player.health > 0
            && Game1.activeClickableMenu == null && !Game1.eventUp && this.anchor() != null;
        return new(at, this.current?.opId, active, phase, this.lastResource, this.current?.remaining ?? 0,
            visible, positions.Count - visible, ms, this.cooldown > at ? this.cooldown : null, label, hudVisible);
    }

    private void DrawLiveStatus(SpriteBatch batch, LiveState live)
    {
        if (!live.hudVisible) return;
        Vector2 size = Game1.smallFont.MeasureString(live.screenLabel);
        Vector2 anchor = Game1.GlobalToLocal(Game1.viewport, this.anchor()!.Value);
        // Below the companion; the voice bubble and its 5-second reading period are independent.
        int x = Math.Clamp((int)(anchor.X - size.X / 2), 8, Math.Max(8, Game1.viewport.Width - (int)size.X - 16));
        int y = Math.Clamp((int)anchor.Y + 82, 8, Math.Max(8, Game1.viewport.Height - (int)size.Y - 16));
        batch.Draw(Game1.staminaRect, new Rectangle(x - 6, y - 4, (int)size.X + 12, (int)size.Y + 8), new Color(35, 28, 22) * .88f);
        batch.DrawString(Game1.smallFont, live.screenLabel, new Vector2(x, y), Color.White);
    }

    internal sealed record LiveState(DateTimeOffset capturedAt, string? opId, bool active, string phase, string resource,
        int remaining, int visibleSwordCount, int offscreenSwordCount, int cooldownRemainingMs, DateTimeOffset? cooldownUntil,
        string screenLabel, bool hudVisible);
    private bool CanShowSwordReturn(GameLocation target, long targetOwner) => Context.IsWorldReady
        && Context.IsMainPlayer && !Context.IsMultiplayer && ReferenceEquals(Game1.currentLocation, target)
        && Game1.player != null && Game1.player.UniqueMultiplayerID == targetOwner && Game1.player.health > 0
        && Game1.shouldTimePass() && Game1.activeClickableMenu == null && !Game1.eventUp
        && !this.blocked() && this.anchor() != null;

    private void PruneSwordReturn()
    {
        if (this.swordReturn is { } returning && ((this.now() - returning.Started).TotalSeconds >= 1
            || !this.CanShowSwordReturn(returning.Location, returning.Owner))) this.swordReturn = null;
    }
    private static int ReadInt(JsonElement args, string name) => args.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int n) ? n : throw new ArgumentException($"{name} 必须是整数。");
    private static NVector ToN(Vector2 p) => new(p.X, p.Y);
    private sealed class Shot
    {
        public Vector2 Position, Direction, Destination;
        public Monster? Target;
        public bool Fired, Done;
        public float Started, Impact = -1;
        public int Impacts;
        public float NextImpact;
        public Queue<Vector2> Trail = new();
    }
    // Properties, not fields: both RPC serializers must include the evidence.
    internal sealed class Receipt
    {
        public string opId { get; }
        public bool preview { get; }
        public int count { get; }
        public string state { get; set; } = "orbit";
        public int hits { get; set; }
        public int damage { get; set; }
        public int kills { get; set; }
        public string resource { get; set; } = "";
        public int resources { get; set; }
        public int impactsPerProjectile { get; set; } = 1;
        public int targetLimit { get; set; } = 12;
        public int fishRollLimit { get; set; } = 3;
        public int targetsSelected { get; set; }
        public int targetsCompleted { get; set; }
        public int remaining { get; set; }
        public string reason { get; set; } = "";
        public LiveState? live { get; set; }
        public Receipt(string id, int count, bool preview) { this.opId = id; this.count = count; this.remaining = count; this.preview = preview; }
    }
}
