using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace DoubaoAI.ONI.Skills
{
    // Camera-aware presentation only. Real mass is owned by ConsumeMass/FallingWater.
    internal sealed class WaterTransferEffect
    {
        private sealed class Burst
        {
            internal WaterTransferFeedback Transfer;
            internal float Started;
        }

        private readonly List<Burst> _bursts = new List<Burst>();
        private Texture2D _drop;
        private const float Duration = 1.6f;

        internal void Play(WaterTransferFeedback transfer)
        {
            if (_bursts.Count == 4) _bursts.RemoveAt(0);
            _bursts.Add(new Burst { Transfer = transfer, Started = Time.unscaledTime });
        }

        internal void Tick()
        {
            _bursts.RemoveAll(b => Time.unscaledTime - b.Started > Duration);
        }

        internal void Draw(Rect fairy, GUIStyle labelStyle)
        {
            if (_bursts.Count == 0 || Event.current.type != EventType.Repaint) return;
            Camera camera = CameraController.Instance == null ? null : CameraController.Instance.baseCamera;
            if (camera == null) return;
            EnsureTexture();
            Color previousColor = GUI.color;
            try
            {
                foreach (Burst burst in _bursts)
                {
                    var transfer = burst.Transfer;
                    if (!Grid.IsValidCell(transfer.Cell)) continue;
                    Vector3 world = Grid.CellToPosCCC(transfer.Cell, Grid.SceneLayer.TileMain);
                    Vector3 screen = camera.WorldToScreenPoint(world);
                    if (screen.z <= 0f) continue;
                    Vector2 target = new Vector2(screen.x, Screen.height - screen.y);
                    Vector2 mouth = new Vector2(fairy.center.x, fairy.y + fairy.height * 0.65f);
                    Vector2 start = transfer.Absorbing ? target : mouth;
                    Vector2 end = transfer.Absorbing ? mouth : target;
                    float age = Time.unscaledTime - burst.Started;
                    float fade = Mathf.Clamp01((Duration - age) / 0.4f);
                    float size = Mathf.Clamp(fairy.width / 12f, 3f, 7f);
                    Color water = new Color(0.22f, 0.73f, 1f);
                    ushort index = ElementLoader.GetElementIndex(transfer.Element);
                    if (index != ushort.MaxValue) water = ElementLoader.elements[index].substance.colour;
                    water.a = 0.9f * fade;
                    // Staggered beads and trailing beads make direction visible, not a static beam.
                    for (int i = 0; i < 24; i++)
                    {
                        float progress = (age - i * 0.027f) / 0.7f;
                        if (progress < 0f || progress > 1f) continue;
                        Vector2 point = Point(start, end, progress, transfer.Absorbing, size, i);
                        Dot(point, size * (0.85f + (i % 3) * 0.16f), water);
                        Color highlight = new Color(0.8f, 0.96f, 1f, water.a * 0.85f);
                        Dot(point + new Vector2(-size * 0.15f, -size * 0.2f), size * 0.35f, highlight);
                        float tail = Mathf.Max(0f, progress - 0.025f);
                        Color trail = water; trail.a *= 0.45f;
                        Dot(Point(start, end, tail, transfer.Absorbing, size, i), size * 0.6f, trail);
                    }
                    // Outward spray splash / inward absorb swirl at the selected world cell.
                    float ripple = Mathf.Clamp01(age / 1.2f);
                    float radius = size * (transfer.Absorbing ? 8f * (1f - ripple) : 7f * ripple);
                    for (int i = 0; i < 12; i++)
                    {
                        float angle = i * Mathf.PI / 6f + age * (transfer.Absorbing ? -3f : 1f);
                        Vector2 offset = new Vector2(Mathf.Cos(angle) * radius, Mathf.Sin(angle) * radius * 0.45f);
                        Dot(target + offset, size * 0.45f, water);
                    }
                    GUI.color = new Color(1f, 1f, 1f, fade);
                    string text = string.Format(CultureInfo.InvariantCulture, "{0} {1:0.#} kg", transfer.Absorbing ? "吸入" : "喷出", transfer.MassKg);
                    float x = Mathf.Clamp(target.x - 65f, 4f, Mathf.Max(4f, Screen.width - 134f));
                    float y = Mathf.Clamp(target.y - 45f - age * 12f, 4f, Mathf.Max(4f, Screen.height - 34f));
                    GUI.Label(new Rect(x, y, 130f, 30f), text, labelStyle);
                }
            }
            finally { GUI.color = previousColor; }
        }

        private static Vector2 Point(Vector2 from, Vector2 to, float t, bool absorb, float size, int bead)
        {
            Vector2 point = Vector2.Lerp(from, to, t);
            point.y -= Mathf.Sin(t * Mathf.PI) * Mathf.Min(90f, Vector2.Distance(from, to) * 0.18f);
            point.y += Mathf.Sin(t * Mathf.PI * 4f + bead * 0.6f) * size * (absorb ? 1.1f : 0.4f);
            return point;
        }

        private void Dot(Vector2 center, float radius, Color color)
        {
            GUI.color = color;
            GUI.DrawTexture(new Rect(center.x - radius, center.y - radius, radius * 2f, radius * 2f), _drop);
        }

        private void EnsureTexture()
        {
            if (_drop != null) return;
            const int size = 32;
            _drop = new Texture2D(size, size, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float dx = (x + 0.5f - size / 2f) / (size / 2f);
                float dy = (y + 0.5f - size / 2f) / (size / 2f);
                pixels[x + y * size] = new Color(1f, 1f, 1f, Mathf.Clamp01((1f - Mathf.Sqrt(dx * dx + dy * dy)) * 8f));
            }
            _drop.SetPixels(pixels);
            _drop.Apply(false, true);
        }

        internal void Dispose()
        {
            _bursts.Clear();
            if (_drop != null) Object.Destroy(_drop);
            _drop = null;
        }
    }
}
