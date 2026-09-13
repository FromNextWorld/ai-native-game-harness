namespace DoubaoAI.ONI.Skills
{
    // Presentation payload, never a second source of mass or a request to spawn liquid.
    internal sealed class WaterTransferFeedback
    {
        internal readonly bool Absorbing;
        internal readonly int Cell;
        internal readonly float MassKg;
        internal readonly SimHashes Element;

        internal WaterTransferFeedback(bool absorbing, int cell, float massKg, SimHashes element)
        {
            Absorbing = absorbing;
            Cell = cell;
            MassKg = massKg;
            Element = element;
        }
    }
}
