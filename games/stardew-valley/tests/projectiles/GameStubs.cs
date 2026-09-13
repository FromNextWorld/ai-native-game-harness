// Deterministic game double for the production controller. Not game acceptance or rendering QA.
namespace Microsoft.Xna.Framework {
    public struct Vector2(float x, float y) {
        public float X = x, Y = y;
        public static Vector2 UnitX => new(1, 0);
        public float LengthSquared() => X * X + Y * Y;
        public static Vector2 Normalize(Vector2 a) => a * (1 / MathF.Sqrt(a.LengthSquared()));
        public static float DistanceSquared(Vector2 a, Vector2 b) => (a - b).LengthSquared();
        public static float Distance(Vector2 a, Vector2 b) => MathF.Sqrt(DistanceSquared(a, b));
        public static Vector2 Lerp(Vector2 a, Vector2 b, float t) => a + (b - a) * t;
        public static Vector2 operator +(Vector2 a, Vector2 b) => new(a.X + b.X, a.Y + b.Y);
        public static Vector2 operator -(Vector2 a, Vector2 b) => new(a.X - b.X, a.Y - b.Y);
        public static Vector2 operator *(Vector2 a, float b) => new(a.X * b, a.Y * b);
    }
    public struct Point(int x, int y) { public int X = x, Y = y; }
    public struct Rectangle(int x, int y, int w, int h) {
        public int X => x; public int Y => y; public int Width => w; public int Height => h;
        public int Left => x; public int Top => y; public int Right => x + w; public int Bottom => y + h;
        public Point Center => new(x + w / 2, y + h / 2);
        public bool Intersects(Rectangle r) => Left < r.Right && Right > r.Left && Top < r.Bottom && Bottom > r.Top;
    }
    public record struct Color(int R, int G, int B) { public static Color White => new(255,255,255); public static Color operator *(Color c, float a) => c; }
    public class GameTime { public TimeSpan ElapsedGameTime = TimeSpan.FromSeconds(1d / 60); }
}
namespace Microsoft.Xna.Framework.Graphics {
    using Microsoft.Xna.Framework;
    public class Texture2D {}
    public class SpriteFont { public Vector2 MeasureString(string text) => new(text.Length*12,20); }
    public class SpriteBatch {
        public void Draw(Texture2D texture, Rectangle bounds, Color color) {}
        public void DrawString(SpriteFont font, string text, Vector2 position, Color color) {}
    }
}
namespace StardewModdingAPI {
    public static class Context { public static bool IsWorldReady = true, IsMultiplayer, IsMainPlayer = true; }
    public enum LogLevel { Trace }
    public interface IMonitor { void Log(string message, LogLevel level); }
}
namespace StardewValley {
    using Microsoft.Xna.Framework;
    public class Character { public Vector2 Position; public virtual Rectangle GetBoundingBox() => new((int)Position.X, (int)Position.Y, 32, 32); }
    public class Farmer : Character { public long UniqueMultiplayerID = 1; public int health = 100; }
    public class GameLocation {
        public List<Character> characters = new(); public FakeMap Map = new(); public bool Invulnerable;
        public int DamageCalls;
        public string? doesTileHaveProperty(int x, int y, string name, string layer) => null;
        public void damageMonster(Rectangle area, int min, int max, bool bomb, Farmer who, bool isProjectile = false) {
            DamageCalls++;
            if (!Invulnerable) foreach (var m in characters.OfType<Monsters.Monster>().Where(m => m.Health > 0 && m.GetBoundingBox().Intersects(area))) m.Health -= min;
        }
    }
    public class FakeMap { public FakeLayer layer = new(); public FakeLayer GetLayer(string _) => layer; }
    public class FakeLayer { public int LayerWidth = 40, LayerHeight = 40; public object?[,] Tiles = new object?[40, 40]; }
    public static class Game1 {
        public static Rectangle viewport = new(0,0,1280,720);
        public static Microsoft.Xna.Framework.Graphics.SpriteFont smallFont = new();
        public static Microsoft.Xna.Framework.Graphics.Texture2D staminaRect = new();
        public static Vector2 GlobalToLocal(Rectangle viewport, Vector2 p) => p-new Vector2(viewport.X,viewport.Y);
        public static Farmer player = new(); public static GameLocation currentLocation = new();
        public static bool eventUp, TimePass = true; public static object? activeClickableMenu;
        public static GameTime? currentGameTime = new(); public static int tileSize = 64;
        public static bool shouldTimePass() => TimePass;
    }
}
namespace StardewValley.Monsters { public class Monster : StardewValley.Character { public int Health = 100; } }
namespace StardewAgentMod.Game.Abilities {
    public class Check { public bool Allowed; public string ReasonLine = "战斗未解锁"; }
    public class AbilityRegistry {
        public const string MineCombat = "mine_combat"; public bool Allow = true; public int Used;
        public Check CanUseIntent(string _) => new() { Allowed = Allow }; public void NoteUsed(string _) => Used++;
    }
}
namespace StardewAgentMod.Game.Companion {
    public class CompanionStamina { public int Current = 15; public bool TrySpend() { if (Current < 1) return false; Current--; return true; } }
}
namespace StardewAgentMod.Game.Combat {
    internal sealed class GrandpaRenderer {
        public static Microsoft.Xna.Framework.Vector2 LastOrigin;
        public static bool LastReturning;
        public void Prepare() {}
        public void Draw(Microsoft.Xna.Framework.Graphics.SpriteBatch b, Microsoft.Xna.Framework.Vector2 p, float t, bool r, Microsoft.Xna.Framework.Vector2? target) { LastOrigin = p; LastReturning = r; }
    }
    internal sealed class ProjectileRenderer {
        public static bool AssetMissing;
        public void Prepare() { if (AssetMissing) throw new InvalidOperationException("贴图缺失"); }
        public void Draw(Microsoft.Xna.Framework.Graphics.SpriteBatch b, Microsoft.Xna.Framework.Vector2 p, Microsoft.Xna.Framework.Vector2 d, IEnumerable<Microsoft.Xna.Framework.Vector2> t, bool done, float a, bool? showBack = null) {}
    }
}
