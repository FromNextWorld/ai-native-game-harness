using System;
using System.IO;
using System.Linq;
using DoubaoAI.ONI.Skills;
using DoubaoAI.ONI.Commands;
using DoubaoAI.ONI.Harness;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

internal static class Program
{
    static int assertions;
    static void Check(bool value,string label) { if(!value)throw new Exception(label); assertions++; }
    static string root=Path.Combine(Path.GetTempPath(),"oni-water-tests-"+Guid.NewGuid().ToString("N"));
    static string path;
    static FairyWaterSkillSystem New(float stored=0)
    {
        Directory.CreateDirectory(root);path=Path.Combine(root,Guid.NewGuid()+".json");
        File.WriteAllText(path,JsonConvert.SerializeObject(new FairyWaterSkillState { Learned=true,StoredElementId="Water",StoredMassKg=stored,StoredTemperatureKelvin=300,StoredDiseaseIndex=2,StoredDiseaseCount=100 }));
        Game.Instance=new Game();SpeedControlScreen.Instance.IsPaused=false;UnityEngine.Time.realtimeSinceStartup=0;SimMessages.Calls=0;
        FallingWater.instance=new FallingWater();
        for(int i=0;i<100;i++){Grid.Element[i]=ElementLoader.elements[0];Grid.Mass[i]=500;Grid.Solid[i]=false;Grid.WorldIdx[i]=0;}
        return new FairyWaterSkillSystem(path);
    }
    static FairyWaterSkillState Saved() => JsonConvert.DeserializeObject<FairyWaterSkillState>(File.ReadAllText(path));
    static void Main()
    {
        var pet=new MinionIdentity();PlayerCommandExecutionResult result=null;
        var skill=New(); int effects=0; WaterTransferFeedback feedback=null;
        skill.TransferConfirmed+=f=>{Check(Saved().PendingTransfer==null,"settlement saved before visual feedback");effects++;feedback=f;};
        skill.Absorb(44,pet,r=>result=r);
        Check(result==null && skill.StoredMassKg==0,"no premature absorb success/storage");
        Check(effects==0,"no speculative animation");
        Check(Saved().PendingTransfer!=null && Saved().StoredMassKg==0,"intent persisted first");
        Check(SimMessages.Width==1 && SimMessages.Height==1,"explicit single cell region");
        skill.Spray(44,pet,r=>Check(!r.Success,"concurrent transfer rejected"));
        Game.Instance.massConsumedCallbackManager.Fire(SimMessages.Callback,new Sim.MassConsumedCallback {elemIdx=0,mass=123,temperature=290,diseaseIdx=3,diseaseCount=7},true);
        Check(result.Success && skill.StoredMassKg==123,"actual partial consumption");
        Check(effects==1 && feedback.Absorbing && feedback.Cell==44 && feedback.MassKg==123,"absorb effect uses actual native amount");
        Check(Saved().StoredTemperatureKelvin==290 && Saved().StoredDiseaseCount==7 && Saved().PendingTransfer==null,"actual payload persisted");
        result=null;Grid.Element[44]=ElementLoader.elements[2];skill.Spray(44,pet,r=>result=r);
        Check(result.Success && skill.StoredMassKg==0,"gas accepts physical droplets");
        Check(FallingWater.instance.Amount==123 && FallingWater.instance.Temperature==290 && FallingWater.instance.DiseaseCount==7,"spray preserves native payload");
        Check(FallingWater.instance.GetInfo(45)[0]==123 && SimMessages.Calls==1,"real particle mass, no duplicate EmitMass");
        Check(FallingWater.instance.StableSpawn,"bounded deterministic native spawn footprint");
        Check(effects==2 && !feedback.Absorbing && feedback.MassKg==123,"spray effect only after particle readback");
        Check(Saved().StoredElementId=="" && Saved().PendingTransfer==null,"last water drains cleanly");
        skill=New(300);FallingWater.instance.Particles[45]=new System.Collections.Generic.Dictionary<int,float> {{0,70},{1,30}};
        skill.Spray(44,pet,r=>result=r);
        Check(result.Success && skill.StoredMassKg==100 && FallingWater.instance.GetInfo(45)[0]==270,"preexisting droplets excluded from settlement");
        Check(FallingWater.instance.GetInfo(45)[1]==30 && Saved().StoredDiseaseCount==33,"other species untouched, disease apportioned");
        skill=New();effects=0;skill.TransferConfirmed+=f=>effects++;skill.Absorb(44,pet,r=>result=r);
        Game.Instance.massConsumedCallbackManager.Fire(SimMessages.Callback,new Sim.MassConsumedCallback {mass=0},true);
        Check(!result.Success && skill.StoredMassKg==0,"zero consumption is failure");
        Check(effects==0,"failed absorption has no success animation");
        skill=New();int replies=0;skill.Absorb(44,pet,r=>{result=r;replies++;});
        UnityEngine.Time.realtimeSinceStartup=11;skill.Tick();skill.Tick();
        Check(!result.Success && replies==1 && skill.StoredMassKg==0,"timeout never claims success or credits");
        skill.Spray(44,pet,r=>Check(!r.Success,"timeout holds transfer lock"));
        Check(SimMessages.Calls==1,"no automatic native retry");
        var reloaded=new FairyWaterSkillSystem(path);reloaded.Spray(44,pet,r=>Check(!r.Success,"reload keeps unresolved lock"));
        int late=0;skill.LateResult+=r=>{Check(r.Success,"late native success");late++;};
        Game.Instance.massConsumedCallbackManager.Fire(SimMessages.Callback,new Sim.MassConsumedCallback {elemIdx=0,mass=200,temperature=300},true);
        Check(late==1 && replies==1 && skill.StoredMassKg==200 && Saved().PendingTransfer==null,"late settlement without duplicate tool reply");
        skill=New(400);SpeedControlScreen.Instance.IsPaused=true;skill.Spray(44,pet,r=>result=r);
        Check(!result.Success && FallingWater.instance.Calls==0,"paused rejected before dispatch");
        SpeedControlScreen.Instance.IsPaused=false;Grid.Solid[44]=true;skill.Spray(44,pet,r=>result=r);
        Check(result.Success && FallingWater.instance.Cell==54,"floor resolves directly above");
        skill=New(400);Grid.Solid[44]=true;Grid.Solid[54]=true;skill.Spray(44,pet,r=>result=r);
        Check(!result.Success && FallingWater.instance.Calls==0,"buried solid still rejected");
        foreach(int element in new[]{0,1,2,3})
        {
            skill=New(400);Grid.Element[44]=ElementLoader.elements[element];skill.Spray(44,pet,r=>result=r);
            Check(result.Success && skill.StoredMassKg==200,"same liquid, other liquid, gas and vacuum all supported: "+element);
        }
        skill=New(400);Grid.WorldIdx[54]=1;Grid.Solid[44]=true;skill.Spray(44,pet,r=>result=r);
        Check(!result.Success && FallingWater.instance.Calls==0,"floor never shifts across worlds");
        skill=New(400);skill.Spray(40,pet,r=>result=r);
        Check(!result.Success && FallingWater.instance.Calls==0,"spawn footprint cannot wrap row or leave world");
        skill=New(400);FallingWater.instance=null;skill.Spray(44,pet,r=>result=r);
        Check(!result.Success && skill.StoredMassKg==400 && Saved().PendingTransfer==null,"missing particle system no dispatch");
        skill=New(400);FallingWater.instance.ThrowOnRead=true;skill.Spray(44,pet,r=>result=r);
        Check(!result.Success && FallingWater.instance.Calls==0 && Saved().PendingTransfer==null,"failed preflight no native dispatch or lock");
        skill=New(400);var invalid=Saved();invalid.StoredTemperatureKelvin=0;
        File.WriteAllText(path,JsonConvert.SerializeObject(invalid));skill=new FairyWaterSkillSystem(path);skill.Spray(44,pet,r=>result=r);
        Check(!result.Success && FallingWater.instance.Calls==0,"invalid native temperature rejected before dispatch");
        foreach(bool throws in new[]{false,true})
        {
            skill=New(400);effects=0;skill.TransferConfirmed+=f=>effects++;
            FallingWater.instance.AcceptedFraction=0.5f;FallingWater.instance.ThrowAfterAdd=throws;
            skill.Spray(44,pet,r=>result=r);
            Check(!result.Success && skill.StoredMassKg==400 && Saved().PendingTransfer!=null && effects==0,"partial/exception locks unresolved transfer, no fake success");
            skill.Spray(44,pet,r=>result=r);
            Check(FallingWater.instance.Calls==1,"uncertain particle injection never auto-retries");
        }
        skill=New(400);skill.TransferConfirmed+=f=>throw new Exception("broken UI");skill.Spray(44,pet,r=>result=r);
        Check(result.Success && skill.StoredMassKg==200 && Saved().PendingTransfer==null,"visual failure cannot break accounting or tool completion");
        // Windows deny-delete sharing simulates an external writer holding the journal.
        if(OperatingSystem.IsWindows())
        {
            skill=New(400);effects=0;skill.TransferConfirmed+=f=>effects++;
            FileStream journalLock=null;
            FallingWater.instance.OnAdded=()=>journalLock=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);
            try { skill.Spray(44,pet,r=>result=r); }
            finally { journalLock?.Dispose(); }
            Check(!result.Success && effects==0 && Saved().PendingTransfer!=null,"save failure after real spawn has no success animation");
            skill.Spray(44,pet,r=>result=r);
            Check(FallingWater.instance.Calls==1,"persistence fault blocks duplicate native injection");
        }
        skill=New(1000);skill.Absorb(44,pet,r=>result=r);Check(!result.Success && SimMessages.Calls==0,"full rejected");
        skill=New();effects=0;skill.TransferConfirmed+=f=>effects++;skill.Absorb(44,pet,r=>result=r);skill.Dispose();
        Game.Instance.massConsumedCallbackManager.Fire(SimMessages.Callback,new Sim.MassConsumedCallback {elemIdx=0,mass=200},true);
        Check(effects==0 && Saved().PendingTransfer!=null,"disposed callback has no effect and preserves unresolved intent");
        BridgeTests();
        Console.WriteLine($"PASS: {assertions} assertions; production water + bridge code, simulated native boundary. Artifacts: {root}");
    }
    static void BridgeTests()
    {
        var bridgeRoot=Path.Combine(root,"bridge");using var bridge=new OniHarnessBridge(bridgeRoot);
        string dir=Directory.GetDirectories(bridgeRoot).Single();int calls=0;Action<PlayerCommandExecutionResult> complete=null;
        bridge.ToolExecution+=(name,args,cb)=>{calls++;complete=cb;};
        Action<string> dispatch=id=>{File.WriteAllText(Path.Combine(dir,"inbox.json"),new JObject { ["events"]=new JArray(new JObject { ["id"]=id,["method"]="tool.execute",["params"]=new JObject {["callId"]="same-call",["name"]="oni_companion_spray_water"} }) }.ToString());bridge.Tick();};
        dispatch("a");Check(!File.Exists(Path.Combine(dir,"outbox.json")),"bridge waits for native completion");
        dispatch("b");Check(calls==1,"duplicate pending call ID not executed");
        complete(new PlayerCommandExecutionResult {Success=true,Reply="confirmed"});
        var output=JObject.Parse(File.ReadAllText(Path.Combine(dir,"outbox.json")));
        Check((bool)output.SelectToken("events[0].params.success"),"bridge forwards confirmed result");
        complete(new PlayerCommandExecutionResult {Success=false});dispatch("c");
        Check(calls==1 && JObject.Parse(File.ReadAllText(Path.Combine(dir,"outbox.json")))["events"].Count()==2,"replay cached result without duplicate execution");
        foreach (string tool in new[] { "oni_inspect_selected", "oni_inspect_colony" }) {
            File.WriteAllText(Path.Combine(dir,"inbox.json"),new JObject { ["events"]=new JArray(new JObject {
                ["id"]=tool,["method"]="tool.execute",["params"]=new JObject { ["callId"]=tool,["name"]=tool }
            }) }.ToString());
            bridge.Tick();
            var last = JObject.Parse(File.ReadAllText(Path.Combine(dir,"outbox.json")))["events"].Last;
            Check((bool)last.SelectToken("params.success") && calls==1, "diagnostics remain available alongside asynchronous water tools: " + tool);
        }
    }
}
