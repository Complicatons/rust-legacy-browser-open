// Compile-check stand-ins for the few Oxide 2.0 types the plugin uses. Never shipped or loaded by a server;
// Oxide's real runtime compiles adapter/RustLegacyBrowser.cs against its own assemblies.
using System;
using System.Collections.Generic;
namespace Oxide.Plugins
{
    public class InfoAttribute : Attribute { public InfoAttribute(string title, string author, string version) { } }
    public class DescriptionAttribute : Attribute { public DescriptionAttribute(string description) { } }
    public class ChatCommandAttribute : Attribute { public ChatCommandAttribute(string command) { } }
    public class Plugin { }
    public class DynamicConfigFile { public object this[string key] { get { return null; } set { } } }
    public class Timers { public void Once(float seconds, Action callback) { } }
    public class WebRequests { public void EnqueuePost(string url, string body, Action<int, string> callback, Plugin owner, Dictionary<string, string> headers = null, float timeout = 0f) { } }
    public class RustLib { public void SendChatMessage(NetUser netUser, string name, string message = null) { } public void BroadcastChat(string name, string message = null) { } }
    public abstract class RustLegacyPlugin : Plugin
    {
        protected DynamicConfigFile Config = new DynamicConfigFile();
        protected Timers timer = new Timers();
        protected WebRequests webrequest = new WebRequests();
        protected RustLib rust = new RustLib();
        protected virtual void LoadDefaultConfig() { }
        protected void Puts(string format, params object[] args) { }
        protected void PrintWarning(string format, params object[] args) { }
        protected void SendReply(NetUser netUser, string format, params object[] args) { }
    }
}
