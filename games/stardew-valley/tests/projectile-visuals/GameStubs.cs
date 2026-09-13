// External game/GPU doubles only. The real renderer, geometry and controller are compiled above.
namespace Microsoft.Xna.Framework {
    public struct Vector2(float x, float y) {
        public Vector2(float value) : this(value, value) {}
        public float X = x, Y = y;
        public static Vector2 UnitX => new(1, 0);
        public float LengthSquared() => X * X + Y * Y;
        public float Length() => MathF.Sqrt(LengthSquared());
        public static Vector2 Normalize(Vector2 a) => a * (1 / a.Length());
        public static float DistanceSquared(Vector2 a, Vector2 b) => (a - b).LengthSquared();
        public static float Distance(Vector2 a, Vector2 b) => MathF.Sqrt(DistanceSquared(a, b));
        public static Vector2 Lerp(Vector2 a, Vector2 b, float t) => a + (b - a) * t;
        public static Vector2 operator +(Vector2 a, Vector2 b) => new(a.X + b.X, a.Y + b.Y);
        public static Vector2 operator -(Vector2 a, Vector2 b) => new(a.X - b.X, a.Y - b.Y);
        public static Vector2 operator *(Vector2 a, float b) => new(a.X * b, a.Y * b);
        public static Vector2 operator /(Vector2 a, float b) => new(a.X / b, a.Y / b);
    }
    public struct Point(int x, int y) { public int X = x, Y = y; }
    public record struct Rectangle(int X, int Y, int Width, int Height) {
        public int Left => X; public int Top => Y; public int Right => X + Width; public int Bottom => Y + Height;
        public Point Center => new(X + Width / 2, Y + Height / 2);
        public bool Intersects(Rectangle r) => Left < r.Right && Right > r.Left && Top < r.Bottom && Bottom > r.Top;
    }
    public record struct Color(int R, int G, int B, int A = 255) {
        public static Color White => new(255, 255, 255);
        public static Color LightGreen => new(144, 238, 144);
        public static Color LightGoldenrodYellow => new(250, 250, 210);
        public static Color operator *(Color c, float a) => c with { A = (int)Math.Clamp(c.A * a, 0, 255) };
    }
    public class GameTime { public TimeSpan ElapsedGameTime = TimeSpan.FromSeconds(1d / 60); }
}
namespace Microsoft.Xna.Framework.Graphics {
    using Microsoft.Xna.Framework;
    public enum SpriteEffects { None }
    public class SpriteFont { public Vector2 MeasureString(string text) => new(text.Length * 12, 20); }
    public class Texture2D(string name, int width, int height) {
        public string Name => name; public int Width => width; public int Height => height;
    }
    public record DrawCall(string Kind, string Texture, Vector2 Position, Rectangle? Source,
        Color Color, float Rotation, Vector2 Origin, Vector2 Scale, float Depth);
    public class SpriteBatch {
        public List<DrawCall> Calls = new();
        public List<string> Text = new();
        public void DrawString(SpriteFont font, string text, Vector2 position, Color color) => Text.Add(text);
        public void Draw(Texture2D texture, Vector2 p, Rectangle? source, Color color, float rotation,
            Vector2 origin, float scale, SpriteEffects effects, float depth) =>
            Calls.Add(new("sprite", texture.Name, p, source, color, rotation, origin, new(scale), depth));
        public void Draw(Texture2D texture, Vector2 p, Rectangle? source, Color color, float rotation,
            Vector2 origin, Vector2 scale, SpriteEffects effects, float depth) =>
            Calls.Add(new("line", texture.Name, p, source, color, rotation, origin, scale, depth));
        public void Draw(Texture2D texture, Rectangle rectangle, Color color) =>
            Calls.Add(new("dot", texture.Name, new(rectangle.X, rectangle.Y), null, color, 0, new(0), new(rectangle.Width, rectangle.Height), 0));
    }
}
namespace StardewModdingAPI {
    public static class Context { public static bool IsWorldReady = true, IsMultiplayer, IsMainPlayer = true; }
    public enum LogLevel { Trace }
    public interface IMonitor { void Log(string message, LogLevel level); }
}
namespace StardewValley {
    using Microsoft.Xna.Framework;
    using Microsoft.Xna.Framework.Graphics;
    public class Character { public string Name = "test"; public Vector2 Position; public Vector2 Tile => Position / 64; public virtual Rectangle GetBoundingBox() => new((int)Position.X, (int)Position.Y, 32, 32); }
    public class Farmer : Character {
        public long UniqueMultiplayerID = 1; public int health = 100, maxHealth = 100, Money; public float Stamina=270, MaxStamina=270;
        public bool CanMove = true; public List<Item> Items = new(); public Item? CurrentItem; public List<Quest> questLog = new();
        public Dictionary<string,Friendship> friendshipData = new(); public int freeSpotsInInventory() => 12;
    }
    public class Item { public string DisplayName = "item"; public string ItemId = "145"; public int Stack; public bool Legendary; public bool HasContextTag(string tag) => tag == "fish_legendary" && Legendary; }
    public class Field<T> { public T Value = default!; }
    public class Quest { public Field<bool> completed = new(); public Field<string> id = new(); public string questTitle = ""; }
    public class NPC : Character { public bool IsMonster; }
    public class Friendship { public int Points; }
    public class Object : Item { public const int FishCategory = -4; public int Category = FishCategory; }
    public class TerrainDictionary : Dictionary<Vector2, TerrainFeatures.TerrainFeature> { public IEnumerable<KeyValuePair<Vector2, TerrainFeatures.TerrainFeature>> Pairs => this; }
    public class GameLocation {
        public string NameOrUniqueName = "Farm"; public bool IsOutdoors=true;
        public List<Character> characters = new(); public FakeMap Map = new(); public int DamageCalls;
        public TerrainDictionary terrainFeatures = new(); public Dictionary<Vector2, Object> Objects = new();
        public HashSet<Vector2> Water = new(); public int FishRolls;
        public bool isWaterTile(int x, int y) => Water.Contains(new(x,y));
        public Item? getFish(float a, string? b, int c, Farmer d, double e, Vector2 f, string? g) { FishRolls++; return new Object(); }
        public string? doesTileHaveProperty(int x, int y, string name, string layer) => null;
        public void damageMonster(Rectangle area, int min, int max, bool bomb, Farmer who, bool isProjectile = false) {
            DamageCalls++;
            foreach (var m in characters.OfType<Monsters.Monster>().Where(m => m.Health > 0 && m.GetBoundingBox().Intersects(area))) m.Health -= min;
        }
    }
    public class FakeMap { public FakeLayer layer = new(); public FakeLayer GetLayer(string _) => layer; }
    public class FakeLayer { public int LayerWidth = 40, LayerHeight = 40; public object?[,] Tiles = new object?[40, 40]; }
    public class FakeContent {
        public Texture2D Sheet = new("companion", 256, 64);
        public T Load<T>(string asset) => (T)(object)Sheet;
    }
    public static class Game1 {
        public static Farmer player = new(); public static GameLocation currentLocation = new();
        public static bool eventUp, TimePass = true; public static object? activeClickableMenu;
        public static GameTime? currentGameTime = new(); public static int tileSize = 64;
        public static FakeContent content = new(); public static Texture2D staminaRect = new("pixel", 1, 1);
        public static int FishDrops;
        public static void createItemDebris(Item item, Vector2 position, int direction, GameLocation location) { FishDrops++; }
        public static Rectangle viewport = new(0, 0, 1280, 720);
        public static SpriteFont smallFont = new();
        public static bool isLightning, isSnowing, isRaining; public static int year=1, dayOfMonth=1, timeOfDay=630; public static string currentSeason="spring";
        public static Vector2 GlobalToLocal(Rectangle view, Vector2 point) => point - new Vector2(view.X, view.Y);
        public static bool shouldTimePass() => TimePass;
    }
}
namespace StardewValley.Tools {
    public class Axe : StardewValley.Item { public StardewValley.Farmer? lastUser; public float Power = 1; }
}
namespace StardewValley.TerrainFeatures {
    using Microsoft.Xna.Framework;
    public class Field<T>(T value) { public T Value = value; }
    public class TerrainFeature { }
    public class Tree : TerrainFeature {
        public Field<int> growthStage = new(5); public Field<float> health = new(12);
        public Field<bool> stump = new(false), falling = new(false), tapped = new(false);
        public int NativeHits;
        // External game damage model only. Production targeting, timing,
        // lifetime, completion evidence and cancellation are NOT replaced.
        public bool performToolAction(StardewValley.Tools.Axe axe, int damage, Vector2 tile) {
            if (axe.lastUser == null || falling.Value || stump.Value || tapped.Value) throw new Exception("invalid native axe use");
            NativeHits++; health.Value -= axe.Power;
            if (health.Value <= 0) falling.Value = true;
            return false;
        }
    }
    public class HoeDirt : TerrainFeature { public const int dry = 0, watered = 1; public Field<int> state = new(dry); public object? crop; public bool readyForHarvest()=>false; }
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
    public class CompanionGrowthSnapshot {}
    public class CompanionLifeSnapshot {}
    public class CompanionStamina { public int Current = 15; public bool TrySpend() { if (Current < 1) return false; Current--; return true; } }
}
namespace StardewAgentMod.Game.Combat {
    // Grandpa is outside this visual change and has its own existing controller/art checks.
    internal sealed class GrandpaRenderer {
        public void Prepare() {}
        public void Draw(Microsoft.Xna.Framework.Graphics.SpriteBatch b, Microsoft.Xna.Framework.Vector2 p, float t, bool r, Microsoft.Xna.Framework.Vector2? target) {}
    }
}
namespace StardewAgentMod.Game {
    public record CompanionRuntimeSnapshot(int Stamina, int StaminaMax, bool IsAirborne, bool IsFlightTransitioning, bool IsCombatAssistActive, bool IsRescueActive);
}
