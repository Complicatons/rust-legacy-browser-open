// Stand-ins for chat.say and the handful of other evidence-site types, matching only member names/signatures
// tools/vanilla-patcher's sites list looks up (never touched by the admission-hook fix itself).
public static class ConsoleSystem {
    public class Arg { }
}

public static class chat {
    public static void say(ref ConsoleSystem.Arg arg) { }
}
