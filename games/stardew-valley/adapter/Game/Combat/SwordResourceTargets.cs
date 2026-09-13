using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xna.Framework;
using StardewValley;
using StardewValley.TerrainFeatures;
using StardewValley.Tools;

namespace StardewAgentMod.Game.Combat;

internal static class SwordResourceTargets
{
    public static List<ProjectileGroup.ResourceTarget> Find(string mode)
    {
        var location = Game1.currentLocation;
        var player = Game1.player;
        var result = new List<ProjectileGroup.ResourceTarget>();
        if (mode == "chop") {
            var axe = player.Items.OfType<Axe>().FirstOrDefault();
            if (axe == null) throw new InvalidOperationException("背包里需要一把斧头，剑阵按这把斧头的能力砍树。");
            foreach (var pair in location.terrainFeatures.Pairs.ToArray()) {
                if (pair.Value is not Tree tree || tree.growthStage.Value < 5 || tree.stump.Value || tree.falling.Value || tree.tapped.Value || location.Objects.ContainsKey(pair.Key)) continue;
                var tile = pair.Key;
                var position = tile * Game1.tileSize + new Vector2(32, 32);
                if (Vector2.DistanceSquared(position, player.Position) > 384 * 384) continue;
                bool removedByImpact = false;
                result.Add(new(position, () => {
                    if (!location.terrainFeatures.TryGetValue(tile, out var current) || !ReferenceEquals(current, tree)
                        || tree.growthStage.Value < 5 || tree.tapped.Value || tree.stump.Value || tree.falling.Value || location.Objects.ContainsKey(tile)
                        || !player.Items.Contains(axe)) return 0;
                    float health = tree.health.Value;
                    var oldUser = axe.lastUser;
                    bool remove;
                    try { axe.lastUser = player; remove = tree.performToolAction(axe, 0, tile); }
                    finally { axe.lastUser = oldUser; }
                    if (remove) {
                        if (location.terrainFeatures.TryGetValue(tile, out var after) && ReferenceEquals(after, tree)) location.terrainFeatures.Remove(tile);
                        removedByImpact = !location.terrainFeatures.TryGetValue(tile, out after) || !ReferenceEquals(after, tree);
                    }
                    // Native tree action owns damage, falling, loot and tool restrictions.
                    return remove || tree.falling.Value || tree.health.Value < health ? 1 : 0;
                }, () => removedByImpact || tree.falling.Value || tree.stump.Value));
            }
        } else if (mode == "water") {
            foreach (var pair in location.terrainFeatures.Pairs.ToArray()) {
                if (pair.Value is not HoeDirt dirt || dirt.state.Value != HoeDirt.dry) continue;
                var tile = pair.Key;
                var position = tile * Game1.tileSize + new Vector2(32, 32);
                if (Vector2.DistanceSquared(position, player.Position) > 384 * 384) continue;
                result.Add(new(position, () => {
                    if (!location.terrainFeatures.TryGetValue(tile, out var current) || !ReferenceEquals(current, dirt) || dirt.state.Value != HoeDirt.dry) return 0;
                    dirt.state.Value = HoeDirt.watered;
                    return dirt.state.Value == HoeDirt.watered ? 1 : 0;
                }));
            }
        } else if (mode == "fish") {
            var origin = player.Tile;
            for (int x = (int)origin.X - 6; x <= origin.X + 6; x++) for (int y = (int)origin.Y - 6; y <= origin.Y + 6; y++) {
                var layer = location.Map.GetLayer("Back");
                if (layer == null || x < 0 || y < 0 || x >= layer.LayerWidth || y >= layer.LayerHeight || !location.isWaterTile(x, y)) continue;
                var tile = new Vector2(x, y);
                var position = tile * Game1.tileSize + new Vector2(32, 32);
                if (Vector2.DistanceSquared(position, player.Position) > 384 * 384) continue;
                result.Add(new(position, () => {
                    if (!location.isWaterTile((int)tile.X, (int)tile.Y)) return 0;
                    // One native roll per impact; no reroll loop, legendary or quest reward farming.
                    var item = location.getFish(0f, null, 2, player, 0d, tile, null);
                    if (item is not StardewValley.Object fish || fish.Category != StardewValley.Object.FishCategory
                        || item.HasContextTag("fish_legendary") || new[] { "159", "160", "163", "682", "775", "898", "899", "900", "901", "902" }.Contains(item.ItemId)) return 0;
                    item.Stack = 1;
                    Game1.createItemDebris(item, player.Position, -1, location);
                    return 1;
                }));
            }
        }
        return result.OrderBy(t => Vector2.DistanceSquared(t.Position, player.Position)).Take(12).ToList();
    }
}
