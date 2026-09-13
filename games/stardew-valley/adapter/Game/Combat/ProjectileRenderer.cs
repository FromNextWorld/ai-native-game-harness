using System;
using System.Collections.Generic;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewValley;

namespace StardewAgentMod.Game.Combat;

/// <summary>Reuse the real mascot sprite, not the larger AI concept portrait.
/// Sword/hand/trails are native pixel primitives: no borrowed weapon or Python dependency.</summary>
internal sealed class ProjectileRenderer
{
    private Texture2D? companion;
    public void Prepare()
    {
        this.companion ??= Game1.content.Load<Texture2D>("Mods/qimidandapigu.XiaoTangYuanCompanion/companion");
        // DRUL sheet: front is cell 0, rear is cell 2. Never silently replace a
        // missing rear view with another front (or a one-eye side view).
        if (this.companion.Width < 192 || this.companion.Height < 64) throw new InvalidOperationException("小汤圆贴图缺少正面或背面。");
    }
    public void Draw(SpriteBatch batch, Vector2 world, Vector2 facing, IEnumerable<Vector2> trail, bool done, float impactAge, bool? showBack = null)
    {
        Vector2 p = Game1.GlobalToLocal(Game1.viewport, world);
        if (impactAge >= 0 && impactAge < 0.25f)
        {
            float t = impactAge / 0.25f;
            for (int i = 0; i < 6; i++) {
                float a = i * MathF.PI / 3;
                Dot(batch, p + new Vector2(MathF.Cos(a), MathF.Sin(a)) * (5 + 18 * t), 3, Color.LightGoldenrodYellow * (1 - t));
            }
        }
        if (done) return;
        int n = 0;
        foreach (Vector2 old in trail) Dot(batch, Game1.GlobalToLocal(Game1.viewport, old), 3, Color.LightGreen * (++n / 10f));
        Vector2 direction = facing.LengthSquared() < 0.001f ? Vector2.UnitX : Vector2.Normalize(facing);
        // Only the real two-eye front and the real back are allowed. Keep the
        // body upright; the sword conveys sideways travel without a side-eye cell.
        // At a horizontal-axis crossing the opposite pair must choose opposite
        // views, too; a Y-only threshold briefly gives five fronts/three backs.
        bool rear = direction.Y < -0.0001f || (Math.Abs(direction.Y) <= 0.0001f && direction.X > 0);
        int sourceX = (showBack ?? rear) ? 128 : 0;
        batch.Draw(this.companion!, p, new Rectangle(sourceX, 0, 64, 64), Color.White, 0, new Vector2(32), 0.4f, SpriteEffects.None, 0.98f);
        Vector2 side = new(-direction.Y, direction.X);
        // A single short dark grip, one mitten, a small gold guard and ONE blade.
        // No jade-colored crossguard wings or opposite-side weapon silhouettes.
        Vector2 hand = p + direction * 12;
        Line(batch, hand - direction * 4, hand + direction * 4, 3, new Color(121, 83, 40));
        Dot(batch, hand, 4, new Color(255, 246, 219));
        Vector2 guard = hand + direction * 4;
        Line(batch, guard - side * 3, guard + side * 3, 3, new Color(184, 138, 59));
        for (int i = 0; i < 22; i++) {
            int width = i < 16 ? 5 : Math.Max(1, (22 - i) / 2);
            Line(batch, guard + direction * (i + 3) - side * width / 2f, guard + direction * (i + 3) + side * width / 2f, 2, new Color(98, 201, 107));
        }
        Line(batch, guard + direction * 3, guard + direction * 24, 1, new Color(222, 255, 164));
        for (int i = 6; i < 20; i += 5) Line(batch, guard + direction * i, guard + direction * (i + 3) + side * 2, 1, Color.LightGoldenrodYellow);
    }
    private static void Dot(SpriteBatch b, Vector2 p, int size, Color color) => b.Draw(Game1.staminaRect, new Rectangle((int)p.X - size / 2, (int)p.Y - size / 2, size, size), color);
    private static void Line(SpriteBatch b, Vector2 start, Vector2 end, int width, Color color)
    {
        Vector2 delta = end - start;
        b.Draw(Game1.staminaRect, start, null, color, MathF.Atan2(delta.Y, delta.X), new Vector2(0, 0.5f), new Vector2(Math.Max(1, delta.Length()), width), SpriteEffects.None, 0.99f);
    }
}
