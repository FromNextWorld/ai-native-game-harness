using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Xna.Framework;
using StardewAgentMod;
using StardewAgentMod.Game.Combat;
using StardewAgentMod.Game.Abilities;
using StardewAgentMod.Game.Companion;
using StardewAgentMod.Harness;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Monsters;
using NVector = System.Numerics.Vector2;

int checks = 0;
void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }
void Reject(Action action, string label) { try { action(); } catch (Exception) { checks++; return; } throw new Exception("Did not reject: " + label); }
JsonElement Args(object value) => JsonSerializer.SerializeToElement(value);
var now = DateTimeOffset.UtcNow;
var abilities = new AbilityRegistry(); var stamina = new CompanionStamina();
bool anchorPresent = true, blocked = false;
var group = new ProjectileGroup(() => anchorPresent ? new Vector2(320, 320) : null, () => blocked, abilities, stamina, new MonitorStub(), () => now);
string id = Guid.NewGuid().ToString();
ProjectileGroup.Receipt Call(string action, object args) => (ProjectileGroup.Receipt)group.Execute(ProjectileGroup.Prefix + action, Args(args));
ProjectileGroup.Receipt Status() => Call("status", new { opId = id });
void Reset() {
    group.Reset(); Game1.currentLocation = new(); Game1.player = new() { Position = new(320, 320) };
    Game1.eventUp = false; Game1.TimePass = true; Game1.activeClickableMenu = null;
    Context.IsWorldReady = true; Context.IsMainPlayer = true; Context.IsMultiplayer = false;
    anchorPresent = true; blocked = false; abilities.Allow = true; abilities.Used = 0; stamina.Current = 15;
    ProjectileRenderer.AssetMissing = false; id = Guid.NewGuid().ToString();
}
void Create(bool preview = true, int count = 8) => Call("create", new { opId = id, count, preview });
void Launch() { Call("formation", new { opId = id, formation = "fan" }); Call("launch", new { opId = id, spacingMs = 120 }); }
void Ticks(int count = 420) { for (int i = 0; i < count; i++) { now = now.AddSeconds(1d / 60); group.Update(); } }

// Resource impacts use injected native targets; verify orchestration and accounting separately from game API build.
var originalGroup = group;
int resourceEffects = 0;
group = new ProjectileGroup(() => Game1.player.Position, () => false, abilities, stamina, new MonitorStub(), () => now,
    _ => new() { new(new Vector2(400, 320), () => { resourceEffects++; return 1; }) });
Reset();
Call("create", new { opId = id, count = 12, preview = false, resource = "fish" });
Launch(); Ticks();
Check(resourceEffects == 3 && Status().resources == 3 && Status().damage == 0, "fish capped at three rolls, not monster damage");
Call("create", new { opId = id, count = 12, preview = false, resource = "fish" });
Ticks(); Check(resourceEffects == 3, "duplicate resource creation cannot repeat loot");
Reset(); resourceEffects = 0;
Call("create", new { opId = id, count = 8, preview = false, resource = "chop" });
Launch(); group.Cancel("voice"); Ticks(); Check(resourceEffects == 0, "recall prevents all later resource effects");
Reset(); Call("create", new { opId = id, count = 8, preview = false, resource = "chop" });
Launch(); Ticks(); Check(Status().resources == 8 && stamina.Current == 14, "chop records successful impacts and costs once");
Reset(); Reject(() => Call("create", new { opId = id, count = 8, preview = true, resource = "fish" }), "resource cannot masquerade as preview");
Reset(); resourceEffects = 0;
Call("create", new { opId = id, count = 12, preview = false, resource = "water" });
Ticks(30); Check(resourceEffects == 0, "opening bridge does not water before launch");
Launch(); Ticks(20); Check(resourceEffects == 0, "water waits for stream travel before effect");
Ticks(5); Check(resourceEffects == 1 && Status().state == "launched", "water changes soil once then waits for return animation");
Ticks(70); Check(Status().state == "completed" && Status().resources == 1, "few targets not duplicated to reach requested count");
Reset(); resourceEffects = 0;
Call("create", new { opId = id, count = 12, preview = false, resource = "water" });
Launch(); group.Cancel("爷爷回去吧"); Ticks(); Check(resourceEffects == 0, "voice recall cancels pending water effects");
Reset(); resourceEffects = 0;
Call("create", new { opId = id, count = 12, preview = false, resource = "water" });
var fixedOrigin = group.WaterOrigin;
Check(fixedOrigin.X == Game1.player.Position.X + 96 && fixedOrigin.Y == Game1.player.Position.Y - 56, "water doorway uses the enlarged performance offset");
Game1.player.Position = new Vector2(700, 320); Ticks(3);
Check(group.WaterOrigin.X == fixedOrigin.X && group.WaterOrigin.Y == fixedOrigin.Y, "water doorway keeps its creation world origin");
group.Draw(new Microsoft.Xna.Framework.Graphics.SpriteBatch());
Check(GrandpaRenderer.LastOrigin.X == fixedOrigin.X && GrandpaRenderer.LastOrigin.Y == fixedOrigin.Y, "draw receives fixed origin after companion moves");
Call("cancel", new { opId = id });
Check(Status().state == "canceled" && Status().remaining == 0 && group.HasFarewell, "cancel stops effects immediately but retains visual farewell");
group.Draw(new Microsoft.Xna.Framework.Graphics.SpriteBatch());
Check(GrandpaRenderer.LastReturning && GrandpaRenderer.LastOrigin.X == fixedOrigin.X, "canceled group still draws return at original doorway");
Call("cancel", new { opId = id }); Ticks(10);
Check(resourceEffects == 0 && group.HasFarewell, "duplicate cancellation never restarts work");
now = now.AddSeconds(1.1); Ticks(1);
Check(!group.HasFarewell, "farewell clears after wall-clock second");
Reset(); Call("create", new { opId = id, count = 12, preview = false, resource = "water" });
Call("cancel", new { opId = id }); Game1.currentLocation = new(); Ticks(1);
Check(!group.HasFarewell, "farewell cannot leak across maps");
group = new ProjectileGroup(() => new Vector2(320, 320), () => false, abilities, stamina, new MonitorStub(), () => now,
    _ => Enumerable.Range(0, 12).Select(i => new ProjectileGroup.ResourceTarget(new Vector2(400, 320), () => 1)).ToList());
Reset(); Call("create", new { opId = id, count = 12, preview = false, resource = "water" });
Launch(); Ticks(360); Check(Status().state == "completed" && Status().resources == 12, "12 water targets and return finish inside TS polling budget");
group = originalGroup; Reset();

for (int n = 1; n <= 12; n++) for (int i = 0; i < n; i++) {
    foreach (string formation in new[] { "orbit", "fan" }) {
        var offset = ProjectileGeometry.Offset(i, n, formation, 1.25);
        var dir = ProjectileGeometry.Direction(NVector.Zero, offset);
        Check(NVector.Dot(offset, dir) > 0, "blade tips must point away from caster");
    }
}
Check(ProjectileGeometry.Intersects(new(0, 5), new(100, 5), 40, 0, 45, 10), "swept hit avoids tunneling");
Check(!ProjectileGeometry.Intersects(new(0, 20), new(100, 20), 40, 0, 45, 10), "parallel miss");
Check(ProjectileGeometry.Intersects(new(41, 5), new(41, 5), 40, 0, 45, 10), "stationary overlap");
Reject(() => ProjectileGeometry.Offset(0, 13, "orbit", 0), "count cap");
Reject(() => ProjectileGeometry.Advance(NVector.Zero, NVector.One, float.NaN), "NaN delta");
Check(ProjectileGeometry.Advance(NVector.Zero, new(1, 0), 0.1f).X == 1, "no overshoot");

Reset(); Create(); Check(Status().state == "orbit", "create is not complete"); Launch(); Ticks();
Check(Status().state == "completed" && Status().remaining == 0, "preview completes and cleans up");
Check(Status().damage == 0 && Game1.currentLocation.DamageCalls == 0 && stamina.Current == 15, "preview never spends or damages");

Reset(); Game1.currentLocation.characters.Add(new Monster { Position = new(520, 320), Health = 1000 });
Create(false); Create(false); Check(stamina.Current == 14 && abilities.Used == 1, "duplicate create spends once");
Launch(); Call("launch", new { opId = id, spacingMs = 120 }); Ticks();
Check(Status().state == "completed" && Status().hits == 8 && Status().damage == 320, "each clone hits at most once with boosted real health delta");
Check(Game1.currentLocation.DamageCalls == 8, "duplicate launch does not repeat damage");
Reject(() => Call("launch", new { opId = id, spacingMs = 120 }), "terminal group cannot relaunch");
Check(JsonSerializer.Serialize(Status()).Contains("\"damage\":320"), "RPC includes evidence properties");

Reset(); Game1.currentLocation.characters.Add(new Monster { Position = new(520, 320), Health = 8 }); Create(false); Launch(); Ticks();
Check(Status().kills == 1 && Status().damage == 8, "dead target not counted or hit again");

Reset(); var a = new Monster { Position = new(520, 320), Health = 1000 }; var b = new Monster { Position = new(520, 320), Health = 1000 };
Game1.currentLocation.characters.AddRange(new Character[] { a, b }); Create(false, 1); Launch(); Ticks();
Check(Status().hits == 1 && Status().damage == 80, "overlapping native AoE victims counted accurately");

Reset(); Game1.currentLocation.characters.Add(new Monster { Position = new(520, 320), Health = 1000 }); Game1.currentLocation.Invulnerable = true; Create(false); Launch(); Ticks();
Check(Status().damage == 0 && Status().hits == 0, "invulnerability is not a successful hit");

Reset(); Game1.currentLocation.characters.Add(new Monster { Position = new(520, 320) }); Create(false); Launch();
for (int y = 0; y < 40; y++) Game1.currentLocation.Map.layer.Tiles[7, y] = new();
Ticks(); Check(Status().hits == 0, "solid building wall blocks flight collision");

Reset(); Create(); group.Cancel("Esc"); Ticks(); Check(Status().state == "canceled" && Status().remaining == 0, "Esc clears clones");
Reset(); Create(); Game1.currentLocation = new(); Ticks(1); Check(Status().state == "canceled", "warp cancels");
Reset(); Create(); Game1.activeClickableMenu = new(); Ticks(1); Check(Status().state == "canceled", "menu cancels");
Reset(); Create(); Game1.eventUp = true; Ticks(1); Check(Status().state == "canceled", "event cancels");
Reset(); Create(); Game1.player.health = 0; Ticks(1); Check(Status().state == "canceled", "death cancels");
Reset(); Create(); anchorPresent = false; Ticks(1); Check(Status().state == "canceled", "missing companion cancels");
Reset(); Create(); now = now.AddSeconds(59); Check(Status().state == "orbit", "summoned formation remains through 59 seconds");
now = now.AddSeconds(1); Check(Status().state == "expired", "60-second wall-clock TTL applies even if animation stops ticking");
Reset(); Create(); group.Reset(); Reject(() => Status(), "save reset clears receipt history");
Reset(); Call("cancel", new { opId = id }); Create(); Check(Status().state == "canceled", "cancel tombstone prevents late create");
Reset(); Create(); Call("cancel", new { opId = id }); Reject(() => Call("create", new { opId = Guid.NewGuid().ToString(), count = 8, preview = true }), "cooldown after cancel");
Reset(); Create(); Reject(() => Call("create", new { opId = Guid.NewGuid().ToString(), count = 8, preview = true }), "no parallel groups");

Reset(); Context.IsMultiplayer = true; Reject(() => Create(), "multiplayer blocked");
Reset(); Context.IsMainPlayer = false; Reject(() => Create(), "nonhost blocked");
Reset(); Context.IsWorldReady = false; Reject(() => Create(), "title blocked");
Reset(); abilities.Allow = false; Reject(() => Create(false), "combat unlock retained"); Create(); Check(stamina.Current == 15, "locked combat still allows harmless preview");
Reset(); stamina.Current = 0; Game1.currentLocation.characters.Add(new Monster { Position = new(520, 320) }); Reject(() => Create(false), "stamina gate");
Reset(); Reject(() => Create(false), "no monsters is not attack success");
Reset(); blocked = true; Reject(() => Create(), "flight blocked");
Reset(); ProjectileRenderer.AssetMissing = true; Reject(() => Create(), "missing sprite fails before action"); Check(stamina.Current == 15, "failed asset load spends nothing");
Reset(); Reject(() => Call("create", new { opId = id, count = 13, preview = true }), "count cap native");
Reject(() => Call("create", new { opId = id, count = 1.2, preview = true }), "fraction count native");
Reject(() => Call("create", new { opId = id, count = 1, preview = "false" }), "preview must be boolean");
Reject(() => Call("create", new { opId = id, count = 1, preview = true, damage = 9999 }), "cannot inject damage");
Reject(() => Call("cancel", new { opId = 1 }), "cancel ID type");
Reset(); Create(); Reject(() => Call("formation", new { opId = id, formation = "unknown" }), "formation whitelist");
Reject(() => Call("launch", new { opId = id, spacingMs = 0 }), "launch interval cap");

// Real loopback WebSocket handshake + inbound atom -> main-thread dispatcher -> RPC result.
Reset();
var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start(); int port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
using var listener = new HttpListener(); listener.Prefixes.Add($"http://127.0.0.1:{port}/"); listener.Start();
using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
var dispatcher = new MainThreadDispatcher(); int calls = 0, closed = 0;
await using var client = new GameAgentClient($"ws://127.0.0.1:{port}/", (atom, args, token) => dispatcher.InvokeAsync<object>(() => {
    calls++; return group.Execute(atom, args);
}, token));
client.TransportClosed += () => closed++;
var publish = client.PublishObservationAsync(new { test = true }, deadline.Token);
var context = await listener.GetContextAsync().WaitAsync(deadline.Token);
using var ws = (await context.AcceptWebSocketAsync(null)).WebSocket;
async Task<JsonElement> Receive() {
    using var stream = new MemoryStream(); var buffer = new byte[8192]; WebSocketReceiveResult message;
    do { message = await ws.ReceiveAsync(buffer, deadline.Token); stream.Write(buffer, 0, message.Count); } while (!message.EndOfMessage);
    return JsonDocument.Parse(stream.ToArray()).RootElement.Clone();
}
async Task Send(object value) => await ws.SendAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value)), WebSocketMessageType.Text, true, deadline.Token);
var hello = await Receive(); Check(hello.GetProperty("params").GetProperty("atoms").GetArrayLength() == 5, "chat hello advertises actual atomic bridge");
await Send(new { jsonrpc = "2.0", id = hello.GetProperty("id"), result = new { ok = true } });
await publish; await Receive();
await Send(new { jsonrpc = "2.0", id = "test-atom", method = "game.atom.execute", @params = new { atom = ProjectileGroup.Prefix + "create", arguments = new { opId = id, count = 8, preview = true } } });
var received = Receive();
while (!received.IsCompleted) { dispatcher.Drain(); await Task.Delay(2, deadline.Token); }
var response = await received;
Check(response.GetProperty("id").GetString() == "test-atom" && response.GetProperty("result").GetProperty("opId").GetString() == id && calls == 1, "atom bridge returns actual dispatcher result");
Check(Status().state == "orbit" && Status().remaining == 8, "WebSocket dispatcher created the actual native group");
await Send(new { jsonrpc = "2.0", id = "bad", method = "game.atom.execute", @params = new { atom = "stardew.delete_everything", arguments = new { } } });
var rejected = await Receive(); Check(rejected.TryGetProperty("error", out _) && calls == 1, "bridge rejects undeclared atoms");
var presented = new List<(string Text, string Source)>();
client.AssistantPresented += (text, source) => presented.Add((text, source));
await Send(new { jsonrpc = "2.0", method = "assistant.action.result", @params = new { atom = "sword:chop", success = false, text = "动作执行失败：背包里需要一把斧头。" } });
for (int i = 0; i < 100 && presented.Count == 0; i++) await Task.Delay(5, deadline.Token);
Check(presented.Count == 1 && presented[0].Text.Contains("斧头") && presented[0].Source == "action-result", "actual action failure must reach the game presentation event, not disappear after a promise");
await Send(new { jsonrpc = "2.0", method = "assistant.action.result", @params = new { atom = "sword:chop", success = true, text = "核实 8 次有效斧击。" } });
for (int i = 0; i < 100 && presented.Count < 2; i++) await Task.Delay(5, deadline.Token);
Check(presented.Count == 2 && presented[1].Text.Contains("有效斧击"), "actual completion evidence reaches the same game presentation event");
await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "test done", deadline.Token);
for (int i = 0; i < 100 && closed == 0; i++) await Task.Delay(5, deadline.Token);
Check(closed > 0, "closed transport signals cleanup");
listener.Stop();
Console.WriteLine($"PASS: {checks} checks; actual controller against game doubles + real loopback WebSocket. No live-game/render acceptance.");

sealed class MonitorStub : IMonitor { public void Log(string message, LogLevel level) {} }
