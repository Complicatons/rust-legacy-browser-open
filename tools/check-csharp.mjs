// Compile check for the Windows C# projects on any OS with the .NET 8 SDK (Linux cloud sessions included), so compile
// errors are found before a Windows build. Nothing is run: on Linux the WinForms SDK is missing, so each project's
// sources are compiled as a plain net8.0 library against Microsoft's Windows Desktop reference pack from NuGet, with
// the same packages, and a stand-in for the generated ApplicationConfiguration. The real build stays
// tools/build-launcher.mjs and tools/build-host-installer.mjs on Windows.
//   node tools/check-csharp.mjs            (Ubuntu: apt-get install dotnet-sdk-8.0)
// Not covered: the adapters (they need the game server's own Managed DLLs) and the C steam_api proxy.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readdirSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const REF='8.0.11',WEBVIEW2='<PackageReference Include="Microsoft.Web.WebView2" Version="1.0.2903.40" />',WMI='<PackageReference Include="System.Management" Version="8.0.0" />';
const cs=dir=>readdirSync(join(root,dir)).filter(f=>f.endsWith('.cs')).map(f=>join(root,dir,f));
// [name, sources, package lines, namespace that needs ApplicationConfiguration (null: none)]
export const PROJECTS=[
 ['launcher',cs('launcher/host'),[WEBVIEW2,WMI],'RustLegacyLauncher'],
 ['launcher-test',['launcher/host/test/Program.cs','launcher/host/ProfileBuilder.cs','launcher/host/TicketPipe.cs','launcher/host/Storage.cs','launcher/host/HardwareId.cs'].map(f=>join(root,f)),[WMI],null],
 ['host-desktop',cs('host/desktop'),[WEBVIEW2],'RustLegacyHostApp'],
];
const env={...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'};
const dotnet=(args,cwd)=>spawnSync('dotnet',args,{cwd,env,encoding:'utf8',timeout:600000});

if(dotnet(['--version']).status!==0){console.error('The .NET 8 SDK (dotnet) is needed. Ubuntu: apt-get install dotnet-sdk-8.0');process.exit(2);}
const work=mkdtempSync(join(tmpdir(),'rlb-cs-'));
try{
 // The reference pack: Windows Forms and friends as reference assemblies, without the Windows-only SDK.
 const refDir=join(homedir(),'.nuget','packages','microsoft.windowsdesktop.app.ref',REF,'ref','net8.0');
 if(!existsSync(refDir)){
  mkdirSync(join(work,'refs'));
  writeFileSync(join(work,'refs','refs.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageDownload Include="Microsoft.WindowsDesktop.App.Ref" Version="[${REF}]" /></ItemGroup></Project>`);
  const r=dotnet(['restore'],join(work,'refs'));if(r.status!==0){console.error(r.stdout+r.stderr);process.exit(2);}
 }
 const refs=readdirSync(refDir).filter(f=>f.endsWith('.dll')).map(f=>`<Reference Include="${join(refDir,f)}" />`).join('');
 let failed=0;
 for(const [name,sources,packages,ns] of PROJECTS){
  const dir=join(work,name);mkdirSync(dir);
  if(ns)writeFileSync(join(dir,'Generated.cs'),`namespace ${ns} { internal static class ApplicationConfiguration { public static void Initialize() { } } }\n`);
  // Same settings as the real projects (Nullable off, no unsafe code); CA1416 is "Windows-only API", expected here.
  writeFileSync(join(dir,name+'.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><OutputType>Library</OutputType><Nullable>disable</Nullable><EnableDefaultCompileItems>false</EnableDefaultCompileItems><NoWarn>CA1416</NoWarn></PropertyGroup><ItemGroup>${ns?'<Compile Include="Generated.cs" />':''}${sources.map(f=>`<Compile Include="${f}" />`).join('')}${refs}${packages.join('')}</ItemGroup><Target Name="DropWebView2Wpf" BeforeTargets="ResolveAssemblyReferences"><ItemGroup><Reference Remove="@(Reference)" Condition="'%(Filename)' == 'Microsoft.Web.WebView2.Wpf'" /></ItemGroup></Target></Project>`);
  const r=dotnet(['build','-c','Release'],dir),out=r.stdout+r.stderr;
  const errors=[...new Set(out.split('\n').filter(l=>/ error /.test(l)).map(l=>l.replace(root+'/','').replace(/ \[.*\]$/,'').trim()))];
  if(r.status===0){console.log(`PASS ${name}`);}else{failed++;console.log(`FAIL ${name}\n  ${errors.join('\n  ')||out.slice(-2000)}`);}
 }
 process.exitCode=failed?1:0;
}finally{rmSync(work,{recursive:true,force:true});}
