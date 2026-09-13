using System;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace DoubaoAI.ONI.GameState
{
    // Read-only game facts. Plans and explanations belong to the TS adapter.
    internal static class SelectedObjectEvidence
    {
        internal static JObject Capture()
        {
            KSelectable selected = SelectTool.Instance == null ? null : SelectTool.Instance.selected;
            if (selected == null) return new JObject { ["available"] = false, ["reason"] = "请先点选要检查的建筑或作物。" };
            var go = selected.gameObject;
            var statuses = new JArray();
            var group = selected.GetStatusItemGroup();
            if (group != null)
                foreach (var entry in group)
                {
                    if (statuses.Count >= 32) break;
                    statuses.Add(entry.GetName());
                }
            var operational = go.GetComponent<Operational>();
            var flags = new JArray();
            if (operational != null)
                foreach (var flag in operational.Flags)
                    flags.Add(new JObject { ["name"] = flag.Key.Name, ["value"] = flag.Value });
            var element = go.GetComponent<PrimaryElement>();
            var power = go.GetComponent<EnergyConsumer>();
            var wire = go.GetComponent<Wire>();
            ushort circuitId = power != null ? power.CircuitID : wire != null ? wire.NetworkID : CircuitManager.INVALID_ID;
            var manager = Game.Instance.circuitManager;
            JObject circuit = null;
            if (manager != null && circuitId != CircuitManager.INVALID_ID)
                circuit = new JObject { ["id"] = circuitId,
                    ["usedW"] = manager.GetWattsUsedByCircuit(circuitId),
                    ["requestedW"] = manager.GetWattsNeededWhenActive(circuitId),
                    ["generatedW"] = manager.GetWattsGeneratedByCircuit(circuitId),
                    ["potentialGenerationW"] = manager.GetPotentialWattsGeneratedByCircuit(circuitId),
                    ["storedJ"] = manager.GetJoulesAvailableOnCircuit(circuitId),
                    ["safeW"] = manager.GetMaxSafeWattageForCircuit(circuitId) };
            var consumer = go.GetComponent<ConduitConsumer>();
            var dispenser = go.GetComponent<ConduitDispenser>();
            var building = go.GetComponent<Building>();
            var pipe = go.GetComponent<Conduit>();
            var priority = go.GetComponent<Prioritizable>();
            var networks = new JArray();
            void Network(ConduitType type, int cell)
            {
                if (!Grid.IsValidCell(cell) || (type != ConduitType.Gas && type != ConduitType.Liquid)) return;
                var flow = Conduit.GetFlowManager(type);
                if (flow == null || !flow.HasConduit(cell)) return;
                var conduit = flow.GetConduit(cell);
                var network = flow.GetNetwork(conduit) as FlowUtilityNetwork;
                if (network == null) return;
                if (networks.Any(n => (int)n["id"] == network.id && (string)n["type"] == type.ToString())) return;
                var cells = new JArray();
                foreach (var member in network.conduits.Take(256))
                {
                    var contents = flow.GetContents(member.Cell);
                    cells.Add(new JObject { ["cell"] = member.Cell, ["element"] = contents.element.ToString(), ["massKg"] = contents.mass,
                        ["permittedFlow"] = flow.GetPermittedFlow(member.Cell).ToString() });
                }
                networks.Add(new JObject { ["id"] = network.id, ["type"] = type.ToString(), ["cells"] = cells,
                    ["truncated"] = network.conduits.Count > 256,
                    ["sources"] = new JArray(network.sources.Select(s => s.Cell)), ["sinks"] = new JArray(network.sinks.Select(s => s.Cell)) });
            }
            if (pipe != null) Network(pipe.type, pipe.Cell);
            if (building != null && consumer != null) Network(consumer.conduitType, building.GetUtilityInputCell());
            if (building != null && dispenser != null) Network(dispenser.conduitType, building.GetUtilityOutputCell());
            return new JObject
            {
                ["available"] = true, ["capturedAt"] = DateTimeOffset.UtcNow.ToString("o"),
                ["instanceId"] = go.GetInstanceID(), ["name"] = selected.GetName(), ["cell"] = Grid.PosToCell(go),
                ["statuses"] = statuses, ["operationalFlags"] = flags,
                ["operational"] = operational == null ? JValue.CreateNull() : new JValue(operational.IsOperational),
                ["active"] = operational == null ? JValue.CreateNull() : new JValue(operational.IsActive),
                ["temperatureC"] = element == null ? JValue.CreateNull() : new JValue(element.Temperature - 273.15f),
                ["circuit"] = circuit,
                ["pipeNetworks"] = networks,
                ["input"] = consumer == null ? null : new JObject { ["connected"] = consumer.IsConnected, ["canConsume"] = consumer.CanConsume,
                    ["storedKg"] = consumer.stored_mass, ["type"] = consumer.conduitType.ToString() },
                ["output"] = dispenser == null ? null : new JObject { ["connected"] = dispenser.IsConnected, ["blocked"] = dispenser.blocked, ["empty"] = dispenser.empty },
                ["priority"] = priority == null ? null : new JObject { ["class"] = priority.GetMasterPriority().priority_class.ToString(), ["value"] = priority.GetMasterPriority().priority_value },
                ["coverage"] = "selected object and associated circuit/pipe network; not worker path permissions or colony forecast"
            };
        }
    }
}
