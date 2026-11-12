/* steam_api proxy for the desktop launcher (DESKTOP-LAUNCHER-PLAN.md, "The proxy"). x86, built by
   tools/build-launcher-proxy.mjs. It sits in the launch profile as steam_api.dll; the player's own steam_api.dll is
   next to it as steam_api_upstream.dll. Every export is a PE forwarder to the upstream (forwards.h), except
   SteamUser() and SteamFriends(), which return the upstream's own objects after pointing them at a copy of their
   vtable with a few slots replaced:

     ISteamUser016    slot 2  GetSteamID            → the launcher's backend ID for the armed server
                      slot 13 GetAuthSessionTicket  → a fresh RLBD envelope from the launcher
                      slot 16 CancelAuthTicket      → no-op for our own ticket handle
     ISteamFriends013 slot 0  GetPersonaName        → the website name
                      slot 7  GetFriendPersonaName  → the website name, for the player's own backend ID only

   Slots and calling conventions are from the original librust.dll bytes (Steam_GetSteamID @0x10002890,
   SteamClient_GetAuth @0x100024c0, Steam_GetDisplayname @0x10002790): thiscall, GetSteamID with a hidden return
   buffer. A thiscall method is written here as __fastcall(this, edx_unused, args...): same registers, same stack,
   callee cleans up.

   The launcher answers over \\.\pipe\rlb-launcher-<user SID> (message mode, current user only; protocol below).
   When the pipe does not exist (launcher closed) or the launcher says no server is armed, every call goes to the
   upstream: the game behaves as before. When the launcher is armed but refuses a ticket, the ticket is empty, so the
   server refuses the login instead of seeing the player's normal Steam ticket under the website ID.

   Pipe protocol (little-endian). Request: one byte, 'I' (identity) or 'T' (ticket).
     Reply byte 0: 0 = not armed, 1 = ok, 2 = refused. On ok:
       'I': u64 backendId, u16 nameLength, name (UTF-8, at most 63 bytes used)
       'T': u64 backendId, u16 ticketLength, ticket (at most 1024 bytes, librust's buffer)  */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <string.h>
#include "forwards.h"

typedef unsigned long long u64;
typedef unsigned short u16;
typedef unsigned int u32;

#define USER_SLOTS 22   /* ISteamUser016 has 22 methods */
#define FRIENDS_MAX 96  /* copied up to the end of the vtable's memory region */
#define OUR_TICKET 0x52424C44u /* never a Steam handle (those count up from 1) */
#define ID_CACHE_MS 1000
#define TICKET_ID_MS 120000
#define PIPE_ID_TIMEOUT 1500
#define PIPE_TICKET_TIMEOUT 9000 /* the server waits 10 s for the ticket */

typedef u64 *(__fastcall *GetSteamID_t)(void *self, void *edx, u64 *out);
typedef u32 (__fastcall *GetAuthSessionTicket_t)(void *self, void *edx, void *ticket, int cbMax, u32 *pcbTicket);
typedef void (__fastcall *CancelAuthTicket_t)(void *self, void *edx, u32 handle);
typedef const char *(__fastcall *GetPersonaName_t)(void *self, void *edx);
typedef const char *(__fastcall *GetFriendPersonaName_t)(void *self, void *edx, u64 id);
typedef void *(__cdecl *Accessor_t)(void);

static HMODULE upstream;
static WCHAR upstreamPath[MAX_PATH];
static CRITICAL_SECTION lock;
static void *userVtbl[USER_SLOTS], **userOrig;
static void *friendsVtbl[FRIENDS_MAX], **friendsOrig;
static WCHAR pipeName[160];

/* Identity cache: what the launcher said last, and until when it holds. */
static int armed;          /* 1 = launcher has a server armed */
static u64 backendId;
static char displayName[64];
static DWORD identityUntil;

/* CallNamedPipe fails at once (ERROR_FILE_NOT_FOUND) in the instant between two of the launcher's listeners, which
   would look like "launcher closed". While the launcher last said it is armed, retry that briefly; when it was not
   armed (or never answered) one try is enough, so a closed launcher costs nothing. */
static int pipeCall(char op, unsigned char *reply, DWORD size, DWORD *got, DWORD timeout)
{
    int tries = armed ? 10 : 1;
    *got = 0;
    if (!pipeName[0]) return 0;
    while (tries--) {
        if (CallNamedPipeW(pipeName, &op, 1, reply, size, got, timeout)) return *got >= 1;
        if (GetLastError() != ERROR_FILE_NOT_FOUND || !tries) return 0;
        Sleep(30);
    }
    return 0;
}

static void takeIdentity(const unsigned char *r, DWORD got, int withName, DWORD holdMs)
{
    armed = 0;
    if (got >= 1 && r[0] == 1 && got >= 11) {
        memcpy(&backendId, r + 1, 8);
        armed = backendId != 0;
        if (withName) {
            u16 n; memcpy(&n, r + 9, 2);
            if (n > sizeof(displayName) - 1) n = sizeof(displayName) - 1;
            if (11u + n > got) n = (u16)(got - 11);
            memcpy(displayName, r + 11, n); displayName[n] = 0;
        }
    }
    identityUntil = GetTickCount() + holdMs;
}

/* Refreshes the cached identity at most once a second (GetSteamID can be called often). */
static int identity(void)
{
    int a;
    EnterCriticalSection(&lock);
    if ((int)(GetTickCount() - identityUntil) >= 0) {
        unsigned char r[11 + 64]; DWORD got;
        if (pipeCall('I', r, sizeof r, &got, PIPE_ID_TIMEOUT)) takeIdentity(r, got, 1, ID_CACHE_MS);
        else { armed = 0; identityUntil = GetTickCount() + ID_CACHE_MS; }
    }
    a = armed;
    LeaveCriticalSection(&lock);
    return a;
}

static u64 *__fastcall MyGetSteamID(void *self, void *edx, u64 *out)
{
    if (identity()) { *out = backendId; return out; }
    return ((GetSteamID_t)userOrig[2])(self, edx, out);
}

static u32 __fastcall MyGetAuthSessionTicket(void *self, void *edx, void *ticket, int cbMax, u32 *pcbTicket)
{
    static unsigned char r[11 + 1024];
    DWORD got; u16 n = 0; int ok;
    EnterCriticalSection(&lock);
    ok = pipeCall('T', r, sizeof r, &got, PIPE_TICKET_TIMEOUT);
    if (!ok || r[0] == 0) {
        armed = 0; identityUntil = GetTickCount() + ID_CACHE_MS;
        LeaveCriticalSection(&lock);
        return ((GetAuthSessionTicket_t)userOrig[13])(self, edx, ticket, cbMax, pcbTicket);
    }
    if (r[0] == 1 && got >= 11) {
        memcpy(&n, r + 9, 2);
        if (11u + n > got || n > (u32)cbMax) n = 0;
        takeIdentity(r, got, 0, TICKET_ID_MS); /* the ID this envelope was minted for */
        if (n) memcpy(ticket, r + 11, n);
    }
    LeaveCriticalSection(&lock);
    if (pcbTicket) *pcbTicket = n; /* refused or malformed: empty ticket, so the server refuses the login */
    return OUR_TICKET;
}

static void __fastcall MyCancelAuthTicket(void *self, void *edx, u32 handle)
{
    if (handle == OUR_TICKET) return;
    ((CancelAuthTicket_t)userOrig[16])(self, edx, handle);
}

static const char *__fastcall MyGetPersonaName(void *self, void *edx)
{
    if (identity() && displayName[0]) return displayName;
    return ((GetPersonaName_t)friendsOrig[0])(self, edx);
}

static const char *__fastcall MyGetFriendPersonaName(void *self, void *edx, u64 id)
{
    if (identity() && displayName[0] && id == backendId) return displayName;
    return ((GetFriendPersonaName_t)friendsOrig[7])(self, edx, id);
}

/* How many pointer slots can be read from `table` without leaving its committed memory region. */
static int readableSlots(void **table, int max)
{
    MEMORY_BASIC_INFORMATION m;
    SIZE_T left;
    if (!VirtualQuery(table, &m, sizeof m) || m.State != MEM_COMMIT || (m.Protect & (PAGE_NOACCESS | PAGE_GUARD))) return 0;
    left = (SIZE_T)((char *)m.BaseAddress + m.RegionSize - (char *)table) / sizeof(void *);
    return (int)(left < (SIZE_T)max ? left : (SIZE_T)max);
}

/* Points `obj` at our copy of its vtable. Only the first vtable seen is wrapped; an object with another vtable
   (never expected) is left untouched, so it simply behaves as the upstream's. */
static void wrap(void *obj, void ***orig, void **ours, int slots, const int *replace, void *const *with, int count)
{
    void **vt;
    int i, n;
    if (!obj) return;
    vt = *(void ***)obj;
    if (vt == ours) return;
    EnterCriticalSection(&lock);
    if (!*orig) {
        n = readableSlots(vt, slots);
        if (n > replace[count - 1]) {
            memcpy(ours, vt, n * sizeof(void *));
            for (i = 0; i < count; i++) ours[replace[i]] = with[i];
            *orig = vt;
        }
    }
    if (*orig == vt) *(void ***)obj = ours;
    LeaveCriticalSection(&lock);
}

/* Loaded on first use, not in DllMain (loader lock). By full path, so no other steam_api_upstream.dll is picked up;
   the forwarders resolve to this same module, already loaded by then. */
static Accessor_t upstreamProc(const char *name)
{
    if (!upstream && upstreamPath[0]) upstream = LoadLibraryW(upstreamPath);
    return upstream ? (Accessor_t)GetProcAddress(upstream, name) : 0;
}

__declspec(dllexport) void *__cdecl SteamUser(void)
{
    static const int slots[] = {2, 13, 16};
    static void *const with[] = {(void *)MyGetSteamID, (void *)MyGetAuthSessionTicket, (void *)MyCancelAuthTicket};
    Accessor_t f = upstreamProc("SteamUser");
    void *obj = f ? f() : 0;
    wrap(obj, &userOrig, userVtbl, USER_SLOTS, slots, with, 3);
    return obj;
}

__declspec(dllexport) void *__cdecl SteamFriends(void)
{
    static const int slots[] = {0, 7};
    static void *const with[] = {(void *)MyGetPersonaName, (void *)MyGetFriendPersonaName};
    Accessor_t f = upstreamProc("SteamFriends");
    void *obj = f ? f() : 0;
    wrap(obj, &friendsOrig, friendsVtbl, FRIENDS_MAX, slots, with, 2);
    return obj;
}

/* \\.\pipe\rlb-launcher-<SID of the user running the game>; the launcher creates it with an ACL for that user. */
static void buildPipeName(void)
{
    HANDLE token;
    unsigned char buf[256];
    DWORD len;
    LPWSTR sid = 0;
    WCHAR override[160];
    /* Tests (tools/build-launcher-proxy.mjs) point the proxy at their own pipe. */
    if (GetEnvironmentVariableW(L"RLB_LAUNCHER_PIPE", override, 160) && override[0]) { lstrcpynW(pipeName, override, 160); return; }
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return;
    if (GetTokenInformation(token, TokenUser, buf, sizeof buf, &len) && ConvertSidToStringSidW(((TOKEN_USER *)buf)->User.Sid, &sid)) {
        lstrcpyW(pipeName, L"\\\\.\\pipe\\rlb-launcher-");
        lstrcpynW(pipeName + lstrlenW(pipeName), sid, 160 - lstrlenW(pipeName));
        LocalFree(sid);
    }
    CloseHandle(token);
}

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved)
{
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        DWORD n;
        DisableThreadLibraryCalls(self);
        InitializeCriticalSection(&lock);
        n = GetModuleFileNameW(self, upstreamPath, MAX_PATH);
        if (n && n < MAX_PATH) {
            while (n && upstreamPath[n - 1] != L'\\') n--;
            upstreamPath[n] = 0;
            if (n + 24 < MAX_PATH) lstrcatW(upstreamPath, L"steam_api_upstream.dll");
            else upstreamPath[0] = 0;
        } else upstreamPath[0] = 0;
        buildPipeName();
    }
    return TRUE;
}
