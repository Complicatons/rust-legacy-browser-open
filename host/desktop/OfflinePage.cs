// The page the window shows while the host service does not answer: the boot screen lives in the dashboard, which the
// service serves, so this says why there is none yet and how to fix it. The window checks the port every 2 s and opens
// the dashboard (and its boot screen) as soon as the service answers.
// Owner decision 7 (29 Oct 2026, HOST-AND-LOADER-BUILD.md): the app may start the Windows service itself from this
// page, one UAC prompt, instead of sending the owner to Services or an elevated PowerShell. The button posts the
// literal string "service.start"; MainForm only honours that exact message, and only while this page (not the
// dashboard) is showing — see MainForm.cs's WebMessageReceived. Everything else about this page still has no bridge.
using System.Net;

namespace RustLegacyHostApp
{
    static class OfflinePage
    {
        // notice: null (first show), "starting" (elevation under way), "cancelled" (the UAC prompt was declined), or
        // "failed" (sc/PowerShell could not start it — most often: not installed yet).
        public static string Html(int port, string notice = null) => @"<!doctype html><html lang=""en""><head><meta charset=""utf-8""><title>Rust Legacy Host</title><style>
html,body{height:100%;margin:0;background:#0a0a0a;color:#b9b5ae;font:500 13px/1.7 'Cascadia Mono',Consolas,monospace}
body{display:grid;grid-template-rows:auto 1fr;background:radial-gradient(120% 90% at 50% 0%,#15110f 0%,#0a0a0a 55%,#070707 100%)}
header{display:flex;align-items:center;gap:10px;padding:12px 32px;border-bottom:1px solid #262626;font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7f7b75}
header i{width:9px;height:9px;background:#cd5a28}
main{padding:44px 72px}
h1{margin:0 0 24px;font:900 44px/1 'Segoe UI Black','Arial Black',sans-serif;letter-spacing:-.01em;text-transform:uppercase;color:#f2efe9}
p{margin:0 0 4px;display:grid;grid-template-columns:7ch 1fr;column-gap:1.5ch}
b{font-weight:700}.fail{color:#ef6b5f}.wait{color:#cd5a28}.fix{color:#cd5a28;font-weight:700;letter-spacing:.12em}
.w b{animation:pulse 1.2s steps(2) infinite}@keyframes pulse{50%{opacity:.35}}
code{color:#f2efe9}
button{margin-top:18px;padding:10px 22px;background:#cd5a28;color:#f2efe9;border:none;font:700 12px/1 'Cascadia Mono',Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
button:disabled{background:#4a3a2e;color:#8a8580;cursor:default}
button:not(:disabled):hover{background:#e06a32}
@media (prefers-reduced-motion:reduce){.w b{animation:none}}
</style></head><body><header><i></i>Rust Legacy Host &middot; start-up</header><main>
<h1>Waiting for the host service</h1>
<p><b class=""fail"">[FAIL]</b><span>No answer from the host service on 127.0.0.1:" + WebUtility.HtmlEncode(port.ToString()) + @".</span></p>" +
(notice == "cancelled" ? @"<p><b class=""fail"">[FAIL]</b><span>The Windows prompt was declined, so the service was not started.</span></p>" :
 notice == "failed" ? @"<p><b class=""fail"">[FAIL]</b><span>Windows could not start the service. Not installed yet? Run <code>Install-RustLegacyHost.ps1 -Apply</code> from the kit as administrator.</span></p>" : "") + @"
<p><span></span><span><button id=""start-service""" + (notice == "starting" ? " disabled" : "") + @">" + (notice == "starting" ? "Starting…" : "Start the service") + @"</button></span></p>
<p><span></span><span>This asks Windows to start it for you, with one administrator prompt. You can also open <code>Services</code>, find <code>Rust Legacy Host</code> and choose Start, or in PowerShell run as administrator: <code>Start-Service RustLegacyHost</code>.</span></p>
<p class=""w""><b class=""wait"">[ .. ]</b><span>Checking again every 2 seconds. The dashboard opens by itself when the service answers.</span></p>
</main><script>document.getElementById('start-service').addEventListener('click',function(e){e.target.disabled=true;window.chrome.webview.postMessage('service.start');});</script></body></html>";
    }
}
