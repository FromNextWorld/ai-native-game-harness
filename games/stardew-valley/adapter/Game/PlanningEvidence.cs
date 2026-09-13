using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using StardewValley;

namespace StardewAgentMod.Game;

/// <summary>On-demand game facts, not a scheduled route or a recommendation engine.</summary>
internal static class PlanningEvidence
{
    internal static object Capture(IReadOnlyDictionary<string, object?> arguments)
    {
        foreach (string key in arguments.Keys)
            if (key != "kind" && key != "npc") throw new ArgumentException("未知检查参数：" + key);
        string? Read(string key) => arguments.TryGetValue(key, out var raw)
            ? raw is JsonElement e && e.ValueKind == JsonValueKind.String ? e.GetString() : raw as string : null;
        string? kind = Read("kind");
        object facts;
        if (kind == "npc" || kind == "route")
        {
            string? name = Read("npc");
            if (string.IsNullOrWhiteSpace(name) || name.Length > 80) throw new ArgumentException("请指定要找的 NPC 名称。");
            var matches = Utility.getAllCharacters().Where(npc => !npc.IsMonster
                && (string.Equals(npc.Name, name, StringComparison.OrdinalIgnoreCase) || string.Equals(npc.displayName, name, StringComparison.OrdinalIgnoreCase)))
                .Select(npc => new { id = npc.Name, name = npc.displayName, location = npc.currentLocation?.NameOrUniqueName,
                    x = (int)npc.Tile.X, y = (int)npc.Tile.Y }).Take(8).ToArray();
            var exits = new List<object>();
            if (kind == "route") foreach (var map in Game1.locations.Take(200))
            {
                foreach (var warp in map.warps.Where(w => !w.npcOnly.Value).Take(40))
                    exits.Add(new { from = map.NameOrUniqueName, to = warp.TargetName, x = warp.X, y = warp.Y, door = false });
                foreach (var door in map.doors.Pairs.Take(40))
                    exits.Add(new { from = map.NameOrUniqueName, to = door.Value, x = door.Key.X, y = door.Key.Y, door = true });
            }
            facts = new { matches, exits, location = Game1.currentLocation.NameOrUniqueName,
                coverage = "已加载地图出口和角色当前位置；门禁、营业时间、动态障碍尚未验通，不能自动传送或声称一定可达。" };
        }
        else if (kind == "inventory")
        {
            facts = new { items = Game1.player.Items.Where(item => item != null).Select(item => new {
                id = item!.QualifiedItemId, name = item.DisplayName, count = item.Stack,
                rawId = item.ItemId, quality = item.quality.Value, category = item.Category,
                edibility = item is StardewValley.Object obj ? (int?)obj.Edibility : null,
            }).ToArray(),
                bundleData = Game1.netWorldState.Value.BundleData,
                bundleProgress = Game1.netWorldState.Value.Bundles.Pairs.ToDictionary(p => p.Key.ToString(), p => p.Value.ToArray()),
                deliveryQuests = Game1.player.questLog.OfType<StardewValley.Quests.ItemDeliveryQuest>().Where(q => !q.completed.Value)
                    .Select(q => new { itemId = q.ItemId.Value, count = q.number.Value, target = q.target.Value }).ToArray(),
                coverage = "随身背包、存档献祭与普通交物任务；不含箱子、特别订单、未来配方或礼物需求。" };
        }
        else if (kind == "day")
        {
            facts = new { year = Game1.year, season = Game1.currentSeason, day = Game1.dayOfMonth, time = Game1.timeOfDay,
                raining = Game1.isRaining, health = Game1.player.health, stamina = Game1.player.Stamina,
                money = Game1.player.Money, location = Game1.currentLocation.NameOrUniqueName,
                tomorrowWeather = Game1.weatherForTomorrow,
                upgradingTool = Game1.player.toolBeingUpgraded.Value?.DisplayName,
                upgradeDaysLeft = Game1.player.daysLeftForToolUpgrade.Value,
                hasPickaxe = Game1.player.Items.Any(i => i is StardewValley.Tools.Pickaxe),
                hasWeapon = Game1.player.Items.Any(i => i is StardewValley.Tools.MeleeWeapon),
                foodCount = Game1.player.Items.OfType<StardewValley.Object>().Where(i => i.Edibility > 0).Sum(i => i.Stack),
                quests = Game1.player.questLog.Select(q => new { id = q.id.Value, title = q.questTitle }).Take(30).ToArray(),
                coverage = "当前日期、身体状态、任务、主地区明日天气和在升级工具；不包含节日营业时间或箱内备用工具。" };
        }
        else throw new ArgumentException("检查类型只能是 npc、route、inventory 或 day。");
        return new { capturedAt = DateTimeOffset.UtcNow, kind, facts };
    }
}
