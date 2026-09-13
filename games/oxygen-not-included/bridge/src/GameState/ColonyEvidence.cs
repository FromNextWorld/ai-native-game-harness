using System;
using Newtonsoft.Json.Linq;

namespace DoubaoAI.ONI.GameState
{
    internal static class ColonyEvidence
    {
        internal static JObject Capture()
        {
            if (ClusterManager.Instance == null || GameClock.Instance == null) return new JObject { ["available"] = false };
            int world = ClusterManager.Instance.activeWorldId;
            double oxygen = 0, calories = 0;
            int population = 0, measuredCells = 0;
            for (int cell = 0; cell < Grid.CellCount; cell++)
                if (Grid.WorldIdx[cell] == world && Grid.Visible[cell] > 0)
                {
                    measuredCells++;
                    if (Grid.Element[cell] != null && Grid.Element[cell].id == SimHashes.Oxygen) oxygen += Grid.Mass[cell];
                }
            foreach (var food in Components.Edibles.Items)
            {
                int cell = Grid.PosToCell(food.gameObject);
                if (Grid.IsValidCell(cell) && Grid.WorldIdx[cell] == world) calories += Math.Max(0, food.Calories);
            }
            foreach (var minion in Components.LiveMinionIdentities.Items)
            {
                int cell = Grid.PosToCell(minion.gameObject);
                if (Grid.IsValidCell(cell) && Grid.WorldIdx[cell] == world) population++;
            }
            return new JObject { ["available"] = true, ["worldId"] = world, ["capturedAt"] = DateTimeOffset.UtcNow.ToString("o"),
                ["cycle"] = GameClock.Instance.GetCycle() + GameClock.Instance.GetCurrentCycleAsPercentage(),
                ["oxygenKg"] = oxygen, ["foodKcal"] = calories / 1000.0, ["population"] = population, ["visibleCells"] = measuredCells,
                ["coverage"] = "visible oxygen and gross edible calories in active world; no reachability, diet or spoilage guarantee" };
        }
    }
}
