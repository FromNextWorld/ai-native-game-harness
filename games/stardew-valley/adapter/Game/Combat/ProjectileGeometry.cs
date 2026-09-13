using System;
using System.Numerics;

namespace StardewAgentMod.Game.Combat;

/// <summary>Pure, bounded formation and swept collision primitives; no game/task dependencies.</summary>
internal static class ProjectileGeometry
{
    public const int MaxCount = 12;
    public const double LifetimeSeconds = 60;
    public const double OrbitPeriodSeconds = 10;
    public static void ValidateCount(int count)
    {
        if (count < 1 || count > MaxCount) throw new ArgumentException("分身数量只能是 1 到 12。");
    }

    public static Vector2 Offset(int index, int count, string formation, double seconds)
    {
        ValidateCount(count);
        if (index < 0 || index >= count || !double.IsFinite(seconds)) throw new ArgumentException("阵型参数无效。");
        if (formation == "fan") {
            // Keep the existing protocol name; presentation is now two tidy staging lanes.
            Vector2 forward = Direction(Vector2.Zero, new Vector2(280, -90));
            Vector2 side = new(-forward.Y, forward.X);
            float lane = count == 1 ? 0 : index % 2 == 0 ? -22 : 22;
            return forward * (58 + index / 2 * 36) + side * lane;
        }
        if (formation != "orbit") throw new ArgumentException("阵型只能是 orbit 或 fan。");
        // Screen Y grows downwards: positive angular velocity is clockwise.
        // Equal phase spacing preserves the tidy ellipse at every instant.
        double angle = ((index + .5) / count + seconds / OrbitPeriodSeconds) * Math.PI * 2;
        return new Vector2((float)Math.Cos(angle) * 92, (float)Math.Sin(angle) * 92 * .7f);
    }

    public static Vector2 Facing(int index, int count, string formation, double seconds)
    {
        var offset = Offset(index, count, formation, seconds);
        return formation == "fan" ? Direction(Vector2.Zero, new Vector2(280, -90)) : Direction(Vector2.Zero, offset);
    }

    public static Vector2 Direction(Vector2 from, Vector2 to)
    {
        Vector2 delta = to - from;
        return delta.LengthSquared() < 0.0001f ? Vector2.UnitX : Vector2.Normalize(delta);
    }

    public static Vector2 Advance(Vector2 from, Vector2 target, float seconds)
    {
        if (!float.IsFinite(seconds) || seconds < 0 || seconds > 0.1f) throw new ArgumentException("帧时间无效。");
        return from + Direction(from, target) * Math.Min(Vector2.Distance(from, target), 520 * seconds);
    }

    // Segment/AABB slab test: fast projectiles cannot skip through a monster between frames.
    public static bool Intersects(Vector2 from, Vector2 to, float left, float top, float right, float bottom)
    {
        float min = 0, max = 1;
        Vector2 delta = to - from;
        return Slab(from.X, delta.X, left, right, ref min, ref max)
            && Slab(from.Y, delta.Y, top, bottom, ref min, ref max);
    }

    private static bool Slab(float origin, float delta, float low, float high, ref float min, ref float max)
    {
        if (Math.Abs(delta) < 0.0001f) return origin >= low && origin <= high;
        float a = (low - origin) / delta, b = (high - origin) / delta;
        min = Math.Max(min, Math.Min(a, b)); max = Math.Min(max, Math.Max(a, b));
        return min <= max;
    }
}
