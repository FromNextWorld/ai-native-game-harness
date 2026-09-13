using System;
using System.Collections.Generic;
using System.Text.Json;

namespace StardewAgentMod.Game.Actions;

/// <summary>Explicit, bounded tile rectangle. Never turns a malformed area into a whole-map action.</summary>
internal sealed record FieldScope(int X, int Y, int Width, int Height)
{
    public bool Contains(int x, int y) => x >= X && y >= Y && x < X + Width && y < Y + Height;

    public static FieldScope? Parse(IReadOnlyDictionary<string, object?> arguments, string locationName)
    {
        if (arguments.Count == 0) return null; // legacy explicit whole-location action
        foreach (string key in arguments.Keys)
            if (key != "location" && key != "x" && key != "y" && key != "width" && key != "height")
                throw new ArgumentException("不支持的区域参数：" + key);
        if (!arguments.TryGetValue("location", out object? location)
            || (location is JsonElement e ? (e.ValueKind == JsonValueKind.String ? e.GetString() : null) : location as string) != locationName)
            throw new ArgumentException("目标地图已变化，请重新选择区域。");
        int Read(string key)
        {
            if (!arguments.TryGetValue(key, out object? value)) throw new ArgumentException("区域缺少参数：" + key);
            if (value is JsonElement json && json.ValueKind == JsonValueKind.Number && json.TryGetInt32(out int number)) return number;
            if (value is int integer) return integer;
            if (value is long wide && wide >= int.MinValue && wide <= int.MaxValue) return (int)wide;
            throw new ArgumentException("区域参数必须是整数：" + key);
        }
        int x = Read("x"), y = Read("y"), width = Read("width"), height = Read("height");
        if (x < 0 || y < 0 || x > 10000 || y > 10000 || width < 1 || height < 1 || width > 64 || height > 64 || width * height > 1024)
            throw new ArgumentException("区域无效，一次最多处理 1024 格。");
        return new FieldScope(x, y, width, height);
    }
}
