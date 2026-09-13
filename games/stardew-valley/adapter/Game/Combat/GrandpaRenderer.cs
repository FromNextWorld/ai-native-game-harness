using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewValley;

namespace StardewAgentMod.Game.Combat;

/// <summary>Approved artwork; the temporary door never creates map entities.</summary>
internal sealed class GrandpaRenderer
{
    private const float GrandpaSize = 120f;
    private const float DoorSize = 192f;
    private const int WaterParticleCount = 40;
    private Texture2D? atlas;
    public void Prepare()
    {
        if (this.atlas is { IsDisposed: false }) return;
        using var stream = typeof(GrandpaRenderer).Assembly.GetManifestResourceStream("StardewAgentMod.GrandpaAtlas")
            ?? throw new InvalidOperationException("爷爷素材缺失，请修复游戏插件。");
        var texture = Texture2D.FromStream(Game1.graphics.GraphicsDevice, stream);
        if (texture.Width != 1254 || texture.Height != 1254) {
            texture.Dispose(); throw new InvalidOperationException("爷爷素材尺寸不正确。");
        }
        // Convert straight PNG alpha to the premultiplied alpha used by Stardew.
        var pixels = new Color[texture.Width * texture.Height];
        texture.GetData(pixels);
        if (pixels[0].A != 0) { texture.Dispose(); throw new InvalidOperationException("爷爷素材透明通道无效。"); }
        for (int i = 0; i < pixels.Length; i++) {
            var c = pixels[i];
            pixels[i] = new Color(c.R * c.A / 255, c.G * c.A / 255, c.B * c.A / 255, (int)c.A);
        }
        texture.SetData(pixels);
        this.atlas = texture;
    }

    public void Draw(SpriteBatch b, Vector2 world, float time, bool returning, Vector2? waterTarget)
    {
        this.Prepare();
        Vector2 home = Game1.GlobalToLocal(Game1.viewport, world);
        Vector2 door = home + new Vector2(-24, -83);
        float doorAlpha = returning ? 1 - Math.Clamp((time - .85f) / .15f, 0, 1) : Math.Clamp(time / .2f, 0, 1);
        float open = returning ? 1 - Math.Clamp((time - .6f) / .25f, 0, 1) : Math.Clamp((time - .15f) / .25f, 0, 1);
        Sprite(b, 0, 1, door, DoorSize, doorAlpha * (1 - open));
        Sprite(b, 1, 1, door, DoorSize, doorAlpha * open);
        Vector2 threshold = door + new Vector2(-5, 40);
        float progress = returning ? Math.Clamp(time / .65f, 0, 1) : Math.Clamp((time - .35f) / .75f, 0, 1);
        Vector2 position = returning ? Vector2.Lerp(home, threshold, progress) : Vector2.Lerp(threshold, home, progress);
        float alpha = returning ? 1 - Math.Clamp((time - .35f) / .3f, 0, 1) : Math.Clamp((time - .35f) / .3f, 0, 1);
        position.Y += MathF.Sin(time * 3) * 2;
        bool pouring = waterTarget.HasValue && !returning;
        // Never mirror the character: that would reverse 孟 on the bowl.
        Sprite(b, pouring ? 1 : 0, 0, position, GrandpaSize, alpha);
        if (!pouring || waterTarget is not Vector2 target) return;
        Vector2 end = Game1.GlobalToLocal(Game1.viewport, target);
        Vector2 start = position + new Vector2(44, 29); // Scaled pour-frame bowl rim.
        for (int i = 0; i < WaterParticleCount; i++) {
            float t = (i / (float)WaterParticleCount + time * 1.1f) % 1;
            Vector2 point = Vector2.Lerp(start, end, t) + new Vector2(0, -24 * 4 * t * (1 - t));
            b.Draw(Game1.staminaRect, new Rectangle((int)point.X, (int)point.Y, 5, 7),
                (i % 2 == 0 ? Color.LightCyan : new Color(191, 135, 246)) * (.8f * alpha));
        }
    }

    private void Sprite(SpriteBatch b, int column, int row, Vector2 center, float size, float alpha)
    {
        if (alpha <= 0) return;
        b.Draw(this.atlas!, center, new Rectangle(column * 627, row * 627, 627, 627),
            Color.White * alpha, 0, new Vector2(313.5f), size / 627f, SpriteEffects.None, .98f);
    }
}
