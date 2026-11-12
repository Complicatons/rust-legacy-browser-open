/* Stand-in for the player's steam_api.dll in the proxy test (tools/build-launcher-proxy.mjs --test). Same calling
   conventions as ISteamUser016 / ISteamFriends013 (thiscall written as __fastcall); every call is counted so the
   test can see what reached the "real" Steam. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string.h>

typedef unsigned long long u64;
typedef unsigned int u32;

__declspec(dllexport) int fakeCalls[32];      /* calls per ISteamUser slot */
__declspec(dllexport) u32 fakeLastCancel;
__declspec(dllexport) int fakeFriendCalls[8];

static void __fastcall Unused(void *self, void *edx) { (void)self; (void)edx; }
static u64 *__fastcall GetSteamID(void *self, void *edx, u64 *out) { (void)self; (void)edx; fakeCalls[2]++; *out = 76561198000000001ULL; return out; }
static u32 __fastcall GetAuthSessionTicket(void *self, void *edx, void *ticket, int cbMax, u32 *pcb)
{
    (void)self; (void)edx; fakeCalls[13]++;
    if (cbMax >= 11) memcpy(ticket, "STEAMTICKET", 11);
    *pcb = 11;
    return 7;
}
static void __fastcall CancelAuthTicket(void *self, void *edx, u32 h) { (void)self; (void)edx; fakeCalls[16]++; fakeLastCancel = h; }
static const char *__fastcall GetPersonaName(void *self, void *edx) { (void)self; (void)edx; fakeFriendCalls[0]++; return "SteamName"; }
static const char *__fastcall GetFriendPersonaName(void *self, void *edx, u64 id) { (void)self; (void)edx; (void)id; fakeFriendCalls[7]++; return "Friend"; }

static void *userVt[22], *friendsVt[70];
static struct { void **vt; } user = {userVt}, friends = {friendsVt};

__declspec(dllexport) void *__cdecl SteamUser(void) { return &user; }
__declspec(dllexport) void *__cdecl SteamFriends(void) { return &friends; }
__declspec(dllexport) int __cdecl SteamAPI_Init(void) { return 1; }

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved)
{
    int i;
    (void)self; (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        for (i = 0; i < 22; i++) userVt[i] = (void *)Unused;
        for (i = 0; i < 70; i++) friendsVt[i] = (void *)Unused;
        userVt[2] = (void *)GetSteamID; userVt[13] = (void *)GetAuthSessionTicket; userVt[16] = (void *)CancelAuthTicket;
        friendsVt[0] = (void *)GetPersonaName; friendsVt[7] = (void *)GetFriendPersonaName;
    }
    return TRUE;
}
