// Minimal deterministic game boundary. Tests compile the production water and bridge code unchanged.
using System;
using System.Collections.Generic;
public enum SimHashes { Water, DirtyWater, Oxygen, Vacuum }
public static class GameTags { public const int AnyWater = 1; }
public class Element
{
    public SimHashes id; public ushort idx; public string name; public bool IsLiquid;
    public bool HasTag(int tag) => IsLiquid;
}
public static class ElementLoader
{
    public static List<Element> elements = new List<Element> {
        new Element {id=SimHashes.Water, idx=0, name="水", IsLiquid=true},
        new Element {id=SimHashes.DirtyWater, idx=1, name="污染水", IsLiquid=true},
        new Element {id=SimHashes.Oxygen, idx=2, name="氧气"},
        new Element {id=SimHashes.Vacuum, idx=3, name="真空"} };
    public static ushort GetElementIndex(SimHashes hash) => (ushort)hash;
}
public class MinionIdentity { public UnityEngine.GameObject gameObject = new UnityEngine.GameObject(); }
public static class Grid
{
    public const int InvalidCell = -1;
    public static Element[] Element = new Element[100]; public static float[] Mass = new float[100];
    public static byte[] WorldIdx = new byte[100]; public static bool[] Solid = new bool[100];
    public static bool IsValidCell(int cell) => cell >= 0 && cell < 100;
    public static int PosToCell(UnityEngine.GameObject obj) => obj.Cell;
    public static int OffsetCell(int cell, int x, int y) => cell + x + 10*y;
    public static bool IsSolidCell(int cell) => Solid[cell];
    public static void CellToXY(int cell, out int x, out int y) { x=cell%10; y=cell/10; }
}
public class CellAddRemoveSubstanceEvent
{
    public CellAddRemoveSubstanceEvent(string a,string b) {} public void Log(int c,SimHashes e,float m,int cb) {}
}
public class SaveLoader
{
    public static SaveLoader Instance;
    public Info GameInfo = new Info(); public class Info { public string colonyGuid; }
}
public class SpeedControlScreen { public static SpeedControlScreen Instance=new SpeedControlScreen(); public bool IsPaused; }
public class Game
{
    public static Game Instance=new Game();
    public CallbackManager<Sim.MassConsumedCallback> massConsumedCallbackManager=new CallbackManager<Sim.MassConsumedCallback>();
    public CallbackManager<Sim.MassEmittedCallback> massEmitCallbackManager=new CallbackManager<Sim.MassEmittedCallback>();
}
public class CallbackManager<T>
{
    public struct Handle { public int index; }
    int next=1; readonly Dictionary<int,Action<T,object>> callbacks=new Dictionary<int,Action<T,object>>();
    public int Count => callbacks.Count;
    public Handle Add(Action<T,object> cb,object data,string debug) { var h=new Handle {index=next++};callbacks[h.index]=cb;return h; }
    public bool IsVersionValid(Handle h) => callbacks.ContainsKey(h.index);
    public void Release(Handle h,string debug) => callbacks.Remove(h.index);
    public void Fire(int index,T info,bool autoRelease=false) { var cb=callbacks[index];if(autoRelease)callbacks.Remove(index);cb(info,null); }
}
public class Sim
{
    public struct MassConsumedCallback { public ushort elemIdx; public byte diseaseIdx; public float mass,temperature; public int diseaseCount; }
    public struct MassEmittedCallback { public ushort elemIdx; public byte suceeded,diseaseIdx; public float mass,temperature; public int diseaseCount; }
}
public class FallingWater
{
    public static FallingWater instance = new FallingWater();
    public int Calls, Cell, DiseaseCount; public float Amount, Temperature, AcceptedFraction=1;
    public byte DiseaseIdx; public bool ThrowAfterAdd, ThrowOnRead, StableSpawn;
    public Action OnAdded;
    public readonly Dictionary<int,Dictionary<int,float>> Particles = new Dictionary<int,Dictionary<int,float>>();
    public Dictionary<int,float> GetInfo(int cell)
    {
        if(ThrowOnRead)throw new Exception("particle system unavailable");
        return Particles.TryGetValue(cell,out var masses) ? masses : new Dictionary<int,float>();
    }
    public void AddParticle(int cell,ushort element,float mass,float temperature,byte disease,int count,
        bool skip_sound=false,bool skip_decor=false,bool debug_track=false,bool disable_randomness=false)
    {
        Calls++;Cell=cell;Amount=mass;Temperature=temperature;DiseaseIdx=disease;DiseaseCount=count;
        StableSpawn=skip_decor && disable_randomness;
        // Exercise adjacent-cell readback and preserve any pre-existing particles.
        var existing=GetInfo(cell+1); existing.TryGetValue(element,out float previous);
        existing[element]=previous+mass*AcceptedFraction;Particles[cell+1]=existing;
        OnAdded?.Invoke();
        if(ThrowAfterAdd)throw new Exception("native spawner partially failed");
    }
}
public static class SimMessages
{
    public static int Calls, Cell, Callback; public static float Amount, Temperature; public static byte Width,Height,DiseaseIdx; public static int DiseaseCount;
    public static void ConsumeMass(int cell,SimHashes element,float mass,byte width,byte height,int callback)
    { Calls++;Cell=cell;Amount=mass;Width=width;Height=height;Callback=callback; }
    public static void EmitMass(int cell,ushort idx,float mass,float temperature,byte disease,int count,int callback)
    { Calls++;Cell=cell;Amount=mass;Temperature=temperature;DiseaseIdx=disease;DiseaseCount=count;Callback=callback; }
}
namespace Klei
{
    public static class SimUtil
    {
        public struct DiseaseInfo { public byte idx;public int count; }
        public static float CalculateFinalTemperature(float a,float at,float b,float bt) => (a*at+b*bt)/(a+b);
        public static DiseaseInfo CalculateFinalDiseaseInfo(byte a,int ac,byte b,int bc) => new DiseaseInfo {idx=b,count=ac+bc};
    }
}
namespace UnityEngine
{
    public class GameObject { public int Cell=44; }
    public static class Time { public static float realtimeSinceStartup; }
    public static class Mathf
    {
        public static float Clamp(float v,float lo,float hi) => Math.Clamp(v,lo,hi);
        public static float Clamp01(float v) => Clamp(v,0,1);
        public static float Min(float a,float b) => Math.Min(a,b);
        public static int RoundToInt(float v) => (int)Math.Round(v);
    }
    public static class Debug { public static void Log(object message) {} public static void LogWarning(object message) {} }
}
namespace DoubaoAI.ONI.GameState { internal class GameSnapshot { internal string PromptContext; } }
namespace DoubaoAI.ONI.GameState {
    internal static class SelectedObjectEvidence { internal static Newtonsoft.Json.Linq.JObject Capture() => new Newtonsoft.Json.Linq.JObject { ["kind"] = "selected" }; }
    internal static class ColonyEvidence { internal static Newtonsoft.Json.Linq.JObject Capture() => new Newtonsoft.Json.Linq.JObject { ["kind"] = "colony" }; }
}
