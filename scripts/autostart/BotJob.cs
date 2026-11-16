using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
public sealed class BotJob : IDisposable {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr p,uint l);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long A,B; public uint Flags; public UIntPtr Min,Max; public uint Active; public UIntPtr Affinity; public uint Priority,Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong A,B,C,D,E,F; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Basic; public IO IO; public UIntPtr A,B,C,D; }
 IntPtr handle;
 public Process Child;
 public ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
 public BotJob(string encoded,string cwd) {
  handle=CreateJobObject(IntPtr.Zero,null);
  if(handle==IntPtr.Zero) throw new Exception("CreateJobObject failed");
  var info=new Extended(); info.Basic.Flags=0x2000;
  int size=Marshal.SizeOf(info); IntPtr ptr=Marshal.AllocHGlobal(size);
  try { Marshal.StructureToPtr(info,ptr,false); if(!SetInformationJobObject(handle,9,ptr,(uint)size)) throw new Exception("Job limits failed"); }
  catch { Dispose(); throw; } finally { Marshal.FreeHGlobal(ptr); }
  Child=new Process();
  Child.StartInfo=new ProcessStartInfo("powershell.exe","-NoProfile -NonInteractive -EncodedCommand "+encoded) { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=cwd, RedirectStandardInput=true, RedirectStandardOutput=true, RedirectStandardError=true };
  Child.OutputDataReceived+=(s,e)=>{if(e.Data!=null) Lines.Enqueue(e.Data);};
  Child.ErrorDataReceived+=(s,e)=>{if(e.Data!=null) Lines.Enqueue(e.Data);};
  try {
   Child.Start();
   if(!AssignProcessToJobObject(handle,Child.Handle)) throw new Exception("Job assignment failed; child not released");
   Child.BeginOutputReadLine(); Child.BeginErrorReadLine();
   Child.StandardInput.WriteLine("go"); Child.StandardInput.Close();
  } catch { if(Child!=null) {try{Child.Kill();}catch{}} Dispose(); throw; }
 }
 public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
}
