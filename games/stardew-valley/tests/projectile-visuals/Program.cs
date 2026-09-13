using System.Text.Json;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewAgentMod.Game.Abilities;
using StardewAgentMod.Game.Combat;
using StardewAgentMod.Game.Companion;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Monsters;
using NVector = System.Numerics.Vector2;

// JSON-lines external game driver. TS tests execute the actual native controller;
// no fixture decides that create/launch/completion has succeeded.
if (args.Contains("--bridge")) {
    var fixture = new Fixture(args.Contains("--resources"));
    string? line;
    while ((line = Console.ReadLine()) != null) {
        try {
            var request = JsonDocument.Parse(line).RootElement;
            string method = request.GetProperty("method").GetString()!;
            object result;
            if (method == "tick") { fixture.Tick(request.GetProperty("frames").GetInt32()); result = new { ok = true }; }
            else if (method == "evidence") result = new { effects = fixture.ResourceEffects, stamina = fixture.Stamina.Current };
            else if (method == "targets") { fixture.TargetsAvailable = request.GetProperty("available").GetBoolean(); result = new { ok = true }; }
            else if (method == "hello") result = ProjectileGroup.AtomDefinitions;
            else if (method == "world") { fixture.PlantWorld(request); result = new { ok = true }; }
            else if (method == "world-evidence") result = fixture.WorldEvidence();
            else result = fixture.Group.Execute(method, request.GetProperty("arguments"));
            Console.WriteLine(JsonSerializer.Serialize(new { result }));
        } catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { error = error.Message })); }
    }
    return 0;
}

int passed = 0, failed = 0;
// Same production cancel/render/status assertion on the installed baseline and merge.
void HiddenCooldownRegression() {
    var f = new Fixture();
    var receipt = JsonSerializer.SerializeToElement(f.Group.Execute(ProjectileGroup.Prefix + "cancel", JsonSerializer.SerializeToElement(new { })));
    Assert(Bodies(f.Draw()).Count == 0, "empty recall unexpectedly renders swords");
    Assert(receipt.TryGetProperty("live", out var live)
        && !live.GetProperty("active").GetBoolean()
        && live.GetProperty("cooldownRemainingMs").GetInt32() == 3000
        && live.GetProperty("screenLabel").GetString()!.Contains("3 秒"),
        "empty recall imposes a hidden 3-second cooldown without matching screen evidence");
}
Test("merged baseline: hidden empty-recall cooldown is visible", HiddenCooldownRegression);
void Assert(bool ok, string message) { if (!ok) throw new Exception(message); }
void Test(string name, Action body) {
    try { body(); passed++; Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failed++; Console.WriteLine($"FAIL {name}: {error.Message}"); }
}
List<DrawCall> Bodies(SpriteBatch batch) => batch.Calls.Where(c => c.Kind == "sprite" && c.Texture == "companion").ToList();
void Balanced(SpriteBatch batch, int count) {
    var bodies = Bodies(batch);
    Assert(bodies.Count == count, $"expected {count} baby draw calls, got {bodies.Count}");
    int front = bodies.Count(c => c.Source == new Rectangle(0, 0, 64, 64));
    int back = bodies.Count(c => c.Source == new Rectangle(128, 0, 64, 64));
    Assert(front + back == count && Math.Abs(front - back) <= 1,
        $"expected front/back balance with no side frames; front={front}, back={back}");
}

Test("create/update/draw uses four real fronts and four real backs", () => {
    var f = new Fixture(); f.Create(); Balanced(f.Draw(), 8);
    foreach (int frames in new[] { 1, 20, 120, 480 }) { f.Tick(frames); Balanced(f.Draw(), 8); }
});
Test("symmetrical orbit rotates clockwise, one turn in ten seconds", () => {
    var f = new Fixture(); f.Create(); var first = Bodies(f.Draw()); f.Tick(150); var next = Bodies(f.Draw());
    for (int i = 0; i < 8; i++) {
        var start = first[i].Position - f.Anchor;
        var expected = f.Anchor + new Vector2(-start.Y / .7f, start.X * .7f);
        Assert(Vector2.Distance(expected, next[i].Position) < .1f, "ring did not make a clockwise quarter turn");
        var a = next[i].Position - f.Anchor; var b = next[(i + 4) % 8].Position - f.Anchor;
        Assert((a + b).Length() < .01f, "opposite ring slots are not symmetric");
    }
    f.Tick(450); var full = Bodies(f.Draw());
    Assert(full.Zip(first).All(pair => Vector2.Distance(pair.First.Position, pair.Second.Position) < .2f), "ten seconds did not return to original slots");
});
Test("rotating front/back balance survives every axis crossing", () => {
    var f = new Fixture(); f.Create();
    for (int frame = 0; frame < 1200; frame++) { Balanced(f.Draw(), 8); f.Tick(1); }
});
Test("babies are subordinate to the original mascot, not 60 percent clones", () => {
    var f = new Fixture(); f.Create();
    Assert(Bodies(f.Draw()).All(b => b.Scale.X >= .35f && b.Scale.X <= .42f), "baby sprite scale must be 0.35..0.42");
});
Test("production renderer never picks one-eye side cells", () => {
    var f = new Fixture(); var renderer = new ProjectileRenderer(); renderer.Prepare();
    foreach (var d in new[] { new Vector2(0,-1), new Vector2(1,-1), new Vector2(-1,-1), new Vector2(1,1), new Vector2(-1,1) }) {
        var b = new SpriteBatch(); renderer.Draw(b, f.Anchor, d, Array.Empty<Vector2>(), false, -1);
        Assert(Bodies(b).Single().Source?.X == (d.Y < 0 ? 128 : 0), "draw ignores travel/ring direction or selects a side eye");
    }
});
Test("a sheet missing the back cell is rejected before spending or creating", () => {
    var f = new Fixture(); Game1.content.Sheet = new("companion", 128, 64);
    bool rejected = false; try { f.Create(false); } catch (InvalidOperationException) { rejected = true; }
    Assert(rejected && f.Stamina.Current == 15 && Bodies(f.Draw()).Count == 0, "missing rear frame was accepted or changed state");
});
Test("staging draws two parallel columns, four babies each", () => {
    var f = new Fixture(); f.Create(); f.Call("formation", new { opId = f.Id, formation = "fan" }); f.Tick(1);
    var bodies = Bodies(f.Draw()); var forward = NVector.Normalize(new NVector(280, -90)); var side = new NVector(-forward.Y, forward.X);
    var lanes = bodies.GroupBy(b => MathF.Round(NVector.Dot(new(b.Position.X-f.Anchor.X, b.Position.Y-f.Anchor.Y), side), 2)).ToArray();
    Assert(lanes.Length == 2 && lanes.All(l => l.Count() == 4), $"expected 2 lanes of 4; got {lanes.Length} lanes");
    foreach (var lane in lanes) {
        var along = lane.Select(b => NVector.Dot(new(b.Position.X-f.Anchor.X, b.Position.Y-f.Anchor.Y), forward)).Order().ToArray();
        Assert(Enumerable.Range(1,3).All(i => Math.Abs(along[i]-along[i-1]-(along[1]-along[0])) < .02f), "uneven column spacing");
    }
});
Test("one short handle and one outward blade per baby", () => {
    var f = new Fixture(); f.Create(); var calls = f.Draw().Calls;
    Assert(calls.Count(c => c.Kind == "line" && c.Color == new Color(121,83,40)) == 8, "not exactly one sword handle per baby");
    foreach (var body in Bodies(f.Draw())) {
        var renderer = new ProjectileRenderer(); renderer.Prepare(); var batch = new SpriteBatch();
        var direction = Vector2.Normalize(body.Position - f.Anchor);
        renderer.Draw(batch, body.Position, direction, Array.Empty<Vector2>(), false, -1);
        var side = new Vector2(-direction.Y, direction.X);
        var greenLines = batch.Calls.Where(c => c.Kind == "line" && c.Color.G > c.Color.R && c.Color.G > c.Color.B);
        foreach (var line in greenLines) {
            foreach (var p in new[] { line.Position, line.Position + new Vector2(MathF.Cos(line.Rotation),MathF.Sin(line.Rotation))*line.Scale.X }) {
                var delta = p-body.Position;
                Assert(delta.X*direction.X+delta.Y*direction.Y > 8, "green blade protrudes through/opposite body");
                Assert(Math.Abs(delta.X*side.X+delta.Y*side.Y) <= 4.1f, "green guard looks like extra side blades");
            }
        }
    }
});
Test("cancel receipt stops gameplay immediately, visual return alone remains", () => {
    var f = new Fixture(); f.Create(false, "chop"); f.Launch();
    var result = f.Call("cancel", new { opId = f.Id });
    Assert(result.state == "canceled" && result.remaining == 0, "cancellation waited for animation");
    Balanced(f.Draw(), 8); f.Tick(50); Balanced(f.Draw(), 8);
    Assert(f.ResourceEffects == 0 && Game1.currentLocation.DamageCalls == 0 && f.Stamina.Current == 14, "return changed resources, damage or refund");
    f.Call("cancel", new { opId = f.Id }); f.Tick(15);
    Assert(Bodies(f.Draw()).Count == 0, "return leaked past one second or duplicate cancel restarted it");
});
Test("normal completion can return visually without replaying hits", () => {
    var f = new Fixture(); f.Create(false); f.Launch();
    for (int i=0; i<400 && f.Status().state != "completed"; i++) f.Tick(1);
    var result = f.Status();
    Assert(result.state == "completed" && result.hits == 8 && result.damage == 320, "boosted combat receipt changed");
    Balanced(f.Draw(), 8); int calls = Game1.currentLocation.DamageCalls; f.Tick(70);
    Assert(Bodies(f.Draw()).Count == 0 && Game1.currentLocation.DamageCalls == calls, "cosmetic return repeats gameplay or leaks");
});
Test("return avoids the mascot and keeps the single blade outward throughout", () => {
    var f = new Fixture(); f.Create(); f.Launch(); f.Tick(30); f.Call("cancel", new { opId=f.Id });
    for (int tick=0; tick<55; tick++) {
        var batch=f.Draw(); Balanced(batch,8); var bodies=Bodies(batch);
        var handles=batch.Calls.Where(c=>c.Kind=="line" && c.Color==new Color(121,83,40)).ToArray();
        Assert(handles.Length==8,"return must keep one handle per baby");
        for(int i=0;i<8;i++) {
            var radial=bodies[i].Position-f.Anchor; var grip=handles[i].Position-bodies[i].Position;
            Assert(radial.Length()>56,"return cuts through central mascot");
            Assert(radial.X*grip.X+radial.Y*grip.Y>0,"return sword points inward");
        }
        f.Tick(1);
    }
});
Test("preview flight keeps both staging lanes pointed toward the same direction", () => {
    // Before the first 294px flight finishes (~0.57s); later completed babies correctly disappear.
    var f=new Fixture(); f.Create(); f.Launch(); f.Tick(20);
    var handles=f.Draw().Calls.Where(c=>c.Kind=="line" && c.Color==new Color(121,83,40)).ToArray();
    Assert(handles.Length==8,"preview lost a baby before finishing its flight");
    Assert(handles.All(h=>Math.Abs(h.Rotation-MathF.Atan2(-90,280))<.01f),"preview blades fan out instead of parallel flight");
});
foreach (string boundary in new[] { "map", "death", "menu", "event", "world", "anchor", "owner", "blocked", "disconnect", "reset" }) {
    Test($"return clears at {boundary} boundary", () => {
        var f = new Fixture(); f.Create(); f.Call("cancel", new { opId = f.Id }); Balanced(f.Draw(), 8);
        switch (boundary) {
            case "map": Game1.currentLocation = new(); break;
            case "death": Game1.player.health = 0; break;
            case "menu": Game1.activeClickableMenu = new(); break;
            case "event": Game1.eventUp = true; break;
            case "world": Context.IsWorldReady = false; break;
            case "anchor": f.AnchorPresent = false; break;
            case "owner": Game1.player.UniqueMultiplayerID++; break;
            case "blocked": f.Blocked = true; break;
            case "disconnect": f.Group.Cancel("disconnect"); break;
            case "reset": f.Group.Reset(); break;
        }
        f.Tick(1); Assert(Bodies(f.Draw()).Count == 0, "return crossed safety boundary");
    });
}
Test("a newly created group never doubles the old cosmetic ring", () => {
    var f = new Fixture(); f.Create(); f.Now = f.Now.AddSeconds(9); f.Call("cancel", new { opId = f.Id });
    f.Id = Guid.NewGuid().ToString(); f.Create(); Balanced(f.Draw(), 8);
});
Test("one through twelve remain supported without changing protocol counts", () => {
    for (int count=1; count<=12; count++) { var f = new Fixture(); f.Create(count:count); f.Tick(4); Balanced(f.Draw(), count); }
});
Test("Grandpa water path does not draw sword babies or a sword return", () => {
    var f = new Fixture(); f.Create(false,"water"); Assert(Bodies(f.Draw()).Count == 0, "water drew swords");
    f.Call("cancel",new { opId=f.Id }); Assert(Bodies(f.Draw()).Count == 0, "water drew a sword return");
});
Test("completed projectiles do not keep a weapon visible", () => {
    var f = new Fixture(); var renderer = new ProjectileRenderer(); renderer.Prepare(); var b = new SpriteBatch();
    renderer.Draw(b, f.Anchor, Vector2.UnitX, Array.Empty<Vector2>(), true, -1);
    Assert(b.Calls.Count == 0, "done projectile still renders");
});

// Regression: drive the actual native lifecycle/render path; only the game/GPU/clock are doubles.
JsonElement Live(Fixture f) => JsonSerializer.SerializeToElement(f.Group.Execute(ProjectileGroup.Prefix + "status", JsonSerializer.SerializeToElement(new { }))).GetProperty("live");
void QuietReady(Fixture f) {
    var live = f.Group.CaptureLiveState();
    Assert(!live.active && live.phase == "ready" && live.cooldownRemainingMs == 0, "test never reached ready state");
    Assert(!live.hudVisible && f.Draw().Text.Count == 0 && f.Draw().Calls.Count == 0,
        "idle ready label or background remains permanently visible");
    var observation = JsonSerializer.SerializeToElement(StardewAgentMod.GameObservationBuilder.Capture(projectiles: live));
    var state = observation.GetProperty("companion").GetProperty("projectiles");
    Assert(state.GetProperty("phase").GetString() == "ready" && !state.GetProperty("hudVisible").GetBoolean()
        && state.GetProperty("screenLabel").GetString()!.Contains("可用"), "hiding HUD erased useful live state");
}
Test("quiet-idle: empty recall shows cooldown then removes both text and background", () => {
    var f = new Fixture(); QuietReady(f);
    f.Group.Execute(ProjectileGroup.Prefix + "cancel", JsonSerializer.SerializeToElement(new { }));
    Assert(f.Draw().Text.Any(t => t.Contains("3 秒")), "active guard countdown was hidden");
    f.Now = f.Now.AddSeconds(3); QuietReady(f);
});
Test("quiet-idle: ring remains labelled after cooldown but disappears after recall", () => {
    var f = new Fixture(); f.Create(); f.Tick(600);
    Assert(f.Draw().Text.Any(t => t.Contains("环绕")), "active ring label was hidden with expired cooldown");
    f.Call("cancel", new { opId=f.Id });
    Assert(f.Draw().Text.Any(t => t.Contains("收回中")), "return label was hidden");
    f.Tick(300); QuietReady(f);
});
Test("quiet-idle: completed combat stops advertising ready indefinitely", () => {
    var f = new Fixture(); f.Create(false); f.Launch(); f.Tick(600); QuietReady(f);
    Assert(f.Status().damage == 320 && f.Status().state == "completed", "idle hiding changed combat evidence");
});
Test("quiet-idle: grandpa also leaves no ready label after returning", () => {
    var f = new Fixture(); f.Create(false, "water"); f.Launch(); f.Tick(600); QuietReady(f);
    Assert(f.Status().resources > 0 && f.Status().state == "completed", "idle hiding changed watering evidence");
});
Test("screen-state: status without an old opId returns current live evidence", () => {
    var f = new Fixture(); f.Create(); var live = Live(f);
    Assert(live.GetProperty("active").GetBoolean() && live.GetProperty("visibleSwordCount").GetInt32() == Bodies(f.Draw()).Count,
        "live evidence disagrees with the real production draw calls");
    Assert(f.Draw().Text.Contains(live.GetProperty("screenLabel").GetString()!), "HUD never draws the label supplied to the model");
});
Test("screen-state: empty recall has no swords but its 3-second guard is visible", () => {
    var f = new Fixture(); f.Group.Execute(ProjectileGroup.Prefix + "cancel", JsonSerializer.SerializeToElement(new { }));
    Assert(Bodies(f.Draw()).Count == 0 && f.Draw().Text.Any(t => t.Contains("未展开") && t.Contains("3 秒")),
        "no swords on screen, yet cancel installed a hidden cooldown with no countdown");
    var live = Live(f);
    Assert(!live.GetProperty("active").GetBoolean() && live.GetProperty("cooldownRemainingMs").GetInt32() == 3000, "empty recall claims an active formation");
    f.Now = f.Now.AddMilliseconds(2883); live = Live(f);
    Assert(live.GetProperty("cooldownRemainingMs").GetInt32() == 117 && f.Draw().Text.Any(t => t.Contains("1 秒")), "countdown is not using native remaining time");
    string error = ""; try { f.Create(); } catch (InvalidOperationException ex) { error = ex.Message; }
    Assert(error.Contains(live.GetProperty("screenLabel").GetString()!), "action rejection disagrees with the on-screen status");
    f.Now = f.Now.AddMilliseconds(117); f.Create(); Assert(Live(f).GetProperty("active").GetBoolean(), "display says ready but execution still refuses");
});
Test("screen-state: canceled gameplay and cosmetic return are separate", () => {
    var f = new Fixture(); f.Create(); f.Call("cancel", new { opId=f.Id });
    var live = Live(f); Assert(!live.GetProperty("active").GetBoolean() && live.GetProperty("phase").GetString() == "returning", "render tail counted as an active action");
    Assert(live.GetProperty("visibleSwordCount").GetInt32() == Bodies(f.Draw()).Count, "return is visible but evidence says absent");
    f.Tick(70); live = Live(f);
    Assert(Bodies(f.Draw()).Count == 0 && !live.GetProperty("active").GetBoolean() && live.GetProperty("phase").GetString() == "cooling_down", "swords disappeared but evidence still says active");
    Assert(f.Draw().Text.Contains(live.GetProperty("screenLabel").GetString()!), "post-return cooldown is hidden");
    var receipt = JsonSerializer.SerializeToElement(f.Status());
    Assert(receipt.GetProperty("live").GetProperty("screenLabel").GetString() == live.GetProperty("screenLabel").GetString(), "historical receipt does not carry current state separately");
});
Test("screen-state: offscreen formation is not confused with a canceled formation", () => {
    var f = new Fixture(); f.Create(); Game1.viewport = new(2000,2000,1280,720);
    var live = Live(f);
    Assert(live.GetProperty("active").GetBoolean() && live.GetProperty("visibleSwordCount").GetInt32() == 0
        && live.GetProperty("screenLabel").GetString()!.Contains("屏幕外"), "viewport absence changed native activity or hid offscreen status");
});
Test("screen-state: expiry is checked even when the render tick comes first", () => {
    var f = new Fixture(); f.Create(); f.Now = f.Now.AddSeconds(60);
    Assert(Bodies(f.Draw()).Count == 0, "expired formation still draws before the next Update");
    var live = Live(f); Assert(!live.GetProperty("active").GetBoolean() && live.GetProperty("phase").GetString() == "ready", "expired receipt remains live");
    f.Group.Reset(); Assert(Live(f).GetProperty("cooldownRemainingMs").GetInt32() == 0, "save reset leaked a cooldown");
});
Test("screen-state: production observation carries the exact HUD state", () => {
    var f = new Fixture(); f.Create(); f.Call("cancel", new { opId=f.Id }); f.Tick(70);
    var state = f.Group.CaptureLiveState();
    var observation = JsonSerializer.SerializeToElement(StardewAgentMod.GameObservationBuilder.Capture(projectiles: state));
    var projected = observation.GetProperty("companion").GetProperty("projectiles");
    Assert(projected.GetProperty("screenLabel").GetString() == state.screenLabel && f.Draw().Text.Contains(state.screenLabel), "observation and HUD diverged");
    Assert(!projected.GetProperty("active").GetBoolean(), "canceled formation revived in observation");
});

if (args.Length == 2 && args[0] == "--state-fixture") {
    var f = new Fixture();
    var receipt = JsonSerializer.SerializeToElement(f.Group.Execute(ProjectileGroup.Prefix + "cancel", JsonSerializer.SerializeToElement(new { })));
    var state = f.Group.CaptureLiveState();
    var observation = StardewAgentMod.GameObservationBuilder.Capture(projectiles: state);
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1]))!);
    File.WriteAllText(args[1], JsonSerializer.Serialize(new { receipt, state, observation, hud = f.Draw().Text }));
}

if (args.Length == 2 && args[0] == "--capture") {
    var f = new Fixture(); f.Create(); var idle = f.Draw().Calls;
    f.Call("formation", new { opId=f.Id, formation="fan" }); f.Tick(1); var stage=f.Draw().Calls;
    f.Call("cancel",new { opId=f.Id }); f.Tick(50); var returned=f.Draw().Calls;
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1]))!);
    File.WriteAllText(args[1],JsonSerializer.Serialize(new { anchor=f.Anchor, idle, stage, returned }, new JsonSerializerOptions { IncludeFields=true, WriteIndented=true }));
}
Console.WriteLine($"RESULT: {passed} passed, {failed} failed. Real production draw calls; external GPU/game doubles, not live game acceptance.");
return failed == 0 ? 0 : 1;

sealed class Fixture {
    public DateTimeOffset Now = DateTimeOffset.Parse("2026-09-11T00:00:00Z");
    public Vector2 Anchor = new(320,320); public bool AnchorPresent=true, Blocked;
    public AbilityRegistry Abilities = new(); public CompanionStamina Stamina = new();
    public ProjectileGroup Group; public string Id = Guid.NewGuid().ToString(); public int ResourceEffects; public bool TargetsAvailable = true;
    private StardewValley.Tools.Axe? testAxe;
    private Farmer? priorAxeUser;
    public Fixture(bool nativeResources = false) {
        Game1.viewport=new(0,0,1280,720);
        Game1.currentLocation=new(); Game1.player=new(){Position=new(320,320)};
        Game1.eventUp=false; Game1.TimePass=true; Game1.activeClickableMenu=null; Game1.content=new(); Game1.currentGameTime=new();
        Context.IsWorldReady=true; Context.IsMainPlayer=true; Context.IsMultiplayer=false;
        Game1.currentLocation.characters.Add(new Monster{Position=new(560,320),Health=1000});
        Group = new(() => AnchorPresent ? Anchor : null, () => Blocked, Abilities, Stamina, new MonitorStub(), () => Now,
            nativeResources ? SwordResourceTargets.Find : _ => TargetsAvailable ? new(){ExternalTarget()} : new());
    }
    private ProjectileGroup.ResourceTarget ExternalTarget() {
        var target = new ProjectileGroup.ResourceTarget(new Vector2(560,320),()=>{ResourceEffects++;return 1;});
        // Allow the identical fixture to compile against the installed protocol too.
        // Real tree tests use SwordResourceTargets, not this generic external target.
        typeof(ProjectileGroup.ResourceTarget).GetProperty("IsCompleted")?.SetValue(target, (Func<bool>)(()=>ResourceEffects>=8));
        return target;
    }
    public void PlantWorld(JsonElement request) {
        Game1.currentLocation.terrainFeatures.Clear(); Game1.player.Items.Clear(); Game1.FishDrops = 0;
        int count = request.TryGetProperty("trees", out var value) ? value.GetInt32() : 8;
        float health = request.TryGetProperty("health", out var hp) ? hp.GetSingle() : 12;
        for (int i=0; i<count; i++) {
            var tree = new StardewValley.TerrainFeatures.Tree(); tree.health.Value=health;
            if (i==0 && request.TryGetProperty("protected", out var p) && p.GetBoolean()) tree.tapped.Value=true;
            Game1.currentLocation.terrainFeatures.Add(new Vector2(6+i%4,4+i/4),tree);
        }
        priorAxeUser = new Farmer(); testAxe = new(){lastUser=priorAxeUser};
        if (!request.TryGetProperty("axe",out var axe) || axe.GetBoolean()) Game1.player.Items.Add(testAxe);
        Game1.currentLocation.Water.Add(new(7,5)); Game1.currentLocation.Water.Add(new(8,5)); Game1.currentLocation.Water.Add(new(7,6));
    }
    public object WorldEvidence() {
        var trees=Game1.currentLocation.terrainFeatures.Values.OfType<StardewValley.TerrainFeatures.Tree>().ToArray();
        return new { felled=trees.Count(t=>t.falling.Value), hits=trees.Sum(t=>t.NativeHits), touched=trees.Count(t=>t.NativeHits>0), protectedHits=trees.Where(t=>t.tapped.Value).Sum(t=>t.NativeHits), stamina=Stamina.Current,
            axePower=testAxe?.Power, axeUserRestored=ReferenceEquals(testAxe?.lastUser,priorAxeUser), fishRolls=Game1.currentLocation.FishRolls, fishDrops=Game1.FishDrops };
    }
    public ProjectileGroup.Receipt Call(string action,object args) => (ProjectileGroup.Receipt)Group.Execute(ProjectileGroup.Prefix+action,JsonSerializer.SerializeToElement(args));
    public void Create(bool preview=true,string? resource=null,int count=8) {
        if (resource==null) Call("create",new{opId=Id,count,preview}); else Call("create",new{opId=Id,count,preview,resource});
    }
    public void Launch() { Call("formation",new{opId=Id,formation="fan"}); Call("launch",new{opId=Id,spacingMs=120}); }
    public ProjectileGroup.Receipt Status()=>Call("status",new{opId=Id});
    public void Tick(int frames) { for(int i=0;i<frames;i++){ Now=Now.AddSeconds(1d/60); Group.Update(); } }
    public SpriteBatch Draw() { var b=new SpriteBatch(); Group.Draw(b); return b; }
}
sealed class MonitorStub : IMonitor { public void Log(string message,LogLevel level) {} }
