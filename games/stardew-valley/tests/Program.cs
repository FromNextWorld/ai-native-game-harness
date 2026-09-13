using System.Text.Json;
using StardewAgentMod.Game.Actions;

var count = 0;
void Check(bool condition) { if (!condition) throw new Exception("FieldScope regression failed"); count++; }
Dictionary<string, object?> Area() => new() { ["location"] = "Farm", ["x"] = 10, ["y"] = 20, ["width"] = 3, ["height"] = 2 };
void Reject(Dictionary<string, object?> args) {
    try { FieldScope.Parse(args, "Farm"); } catch (ArgumentException) { count++; return; }
    throw new Exception("Invalid area was not rejected");
}
Check(FieldScope.Parse(new Dictionary<string, object?>(), "Farm") == null);
var scope = FieldScope.Parse(Area(), "Farm")!;
Check(scope.Contains(10, 20)); Check(scope.Contains(12, 21));
Check(!scope.Contains(13, 21)); Check(!scope.Contains(12, 22)); Check(!scope.Contains(9, 20));
foreach (string key in Area().Keys) { var area = Area(); area.Remove(key); Reject(area); }
foreach (var pair in new (string, object)[] { ("location", "Town"), ("width", 0), ("width", 65), ("x", -1), ("x", 10001), ("y", "20"), ("height", 1.5), ("extra", true) }) {
    var area = Area(); area[pair.Item1] = pair.Item2; Reject(area);
}
var large = Area(); large["width"] = 64; large["height"] = 64; Reject(large);
using var json = JsonDocument.Parse("{\"location\":\"Farm\",\"x\":10,\"y\":20,\"width\":3,\"height\":2}");
Check(FieldScope.Parse(json.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value), "Farm") == scope);
Console.WriteLine($"FieldScope: {count} assertions passed");
