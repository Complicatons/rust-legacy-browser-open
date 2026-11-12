/* Proxy test (tools/build-launcher-proxy.mjs --test). Loads build/launcher/proxy-test/steam_api.dll (the proxy) with
   fake_upstream.c beside it as steam_api_upstream.dll, plays the launcher's pipe itself, and calls the wrapped
   interfaces the way librust.dll does. Exit code 0 = every check passed. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>

typedef unsigned long long u64;
typedef unsigned short u16;
typedef unsigned int u32;
typedef u64 *(__fastcall *GetSteamID_t)(void *self, void *edx, u64 *out);
typedef u32 (__fastcall *GetAuthSessionTicket_t)(void *self, void *edx, void *ticket, int cbMax, u32 *pcb);
typedef void (__fastcall *CancelAuthTicket_t)(void *self, void *edx, u32 h);
typedef const char *(__fastcall *GetPersonaName_t)(void *self, void *edx);
typedef const char *(__fastcall *GetFriendPersonaName_t)(void *self, void *edx, u64 id);
typedef void *(__cdecl *Accessor_t)(void);
typedef int (__cdecl *Init_t)(void);

#define BACKEND 90000000004821733ULL
#define STEAM 76561198000000001ULL
static const WCHAR *PIPE = L"\\\\.\\pipe\\rlb-launcher-proxy-test";
static volatile LONG mode;          /* 0 not armed, 1 armed, 2 armed but refuses tickets */
static volatile LONG requests;
static unsigned char envelope[53];
static int failures;

#define CHECK(c, what) do { if (c) printf("ok   %s\n", what); else { printf("FAIL %s\n", what); failures++; } } while (0)

/* One connected client: read the request byte, answer for the current mode. */
static DWORD WINAPI serveOne(LPVOID arg)
{
    HANDLE h = (HANDLE)arg;
    {
        unsigned char req, rep[11 + 64];
        DWORD got, len = 1;
        {
            if (ReadFile(h, &req, 1, &got, NULL) && got == 1) {
                u64 id = BACKEND; u16 n;
                InterlockedIncrement(&requests);
                rep[0] = (unsigned char)(mode == 0 ? 0 : (mode == 2 && req == 'T') ? 2 : 1);
                if (rep[0] == 1) {
                    memcpy(rep + 1, &id, 8);
                    if (req == 'I') { n = 7; memcpy(rep + 9, &n, 2); memcpy(rep + 11, "Website", 7); len = 18; }
                    else { n = sizeof envelope; memcpy(rep + 9, &n, 2); len = 11; }
                }
                if (rep[0] == 1 && req == 'T') {
                    unsigned char big[11 + sizeof envelope];
                    memcpy(big, rep, 11); memcpy(big + 11, envelope, sizeof envelope);
                    WriteFile(h, big, sizeof big, &got, NULL);
                } else WriteFile(h, rep, len, &got, NULL);
                FlushFileBuffers(h);
            }
        }
        DisconnectNamedPipe(h);
        CloseHandle(h);
    }
    return 0;
}

/* Like the launcher host: the next listener exists before the current client is served. */
static DWORD WINAPI pipeServer(LPVOID arg)
{
    (void)arg;
    for (;;) {
        HANDLE h = CreateNamedPipeW(PIPE, PIPE_ACCESS_DUPLEX, PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES, 2048, 2048, 0, NULL);
        if (h == INVALID_HANDLE_VALUE) return 1;
        if (ConnectNamedPipe(h, NULL) || GetLastError() == ERROR_PIPE_CONNECTED) CloseHandle(CreateThread(NULL, 0, serveOne, h, 0, NULL));
        else CloseHandle(h);
    }
}

int main(void)
{
    HMODULE proxy, fake;
    void *user, *friends, **uvt, **fvt;
    int *fakeCalls, *fakeFriendCalls;
    u32 *fakeLastCancel;
    u64 id;
    unsigned char ticket[1024];
    u32 len, handle;
    int i;

    for (i = 0; i < (int)sizeof envelope; i++) envelope[i] = (unsigned char)(i == 0 ? 'R' : i == 1 ? 'L' : i == 2 ? 'B' : i == 3 ? 'D' : i);
    SetEnvironmentVariableW(L"RLB_LAUNCHER_PIPE", PIPE); /* read by the proxy's DllMain */
    proxy = LoadLibraryW(L"steam_api.dll");
    CHECK(proxy != NULL, "proxy loads");
    if (!proxy) return 1;
    /* A forwarder loads the upstream when it is first resolved, as librust's imports do at load time. */
    CHECK(GetProcAddress(proxy, "SteamAPI_Init") && ((Init_t)GetProcAddress(proxy, "SteamAPI_Init"))() == 1, "forwarded export reaches the upstream");
    fake = GetModuleHandleW(L"steam_api_upstream.dll");
    CHECK(fake != NULL, "upstream loaded from beside the proxy");
    if (!fake) return 1;
    fakeCalls = (int *)GetProcAddress(fake, "fakeCalls");
    fakeFriendCalls = (int *)GetProcAddress(fake, "fakeFriendCalls");
    fakeLastCancel = (u32 *)GetProcAddress(fake, "fakeLastCancel");
    CHECK(GetProcAddress(proxy, "IsLumaEmu") == NULL, "a name the upstream lacks resolves to nothing (no crash)");
    CHECK(GetProcAddress(proxy, "SteamAPI_Init") == GetProcAddress(fake, "SteamAPI_Init"), "forwarder resolves to the upstream's own function");

    user = ((Accessor_t)GetProcAddress(proxy, "SteamUser"))();
    friends = ((Accessor_t)GetProcAddress(proxy, "SteamFriends"))();
    CHECK(user == ((Accessor_t)GetProcAddress(fake, "SteamUser"))(), "SteamUser returns the upstream object");
    uvt = *(void ***)user; fvt = *(void ***)friends;

    /* 1. No launcher pipe: everything is the player's own Steam. */
    ((GetSteamID_t)uvt[2])(user, 0, &id);
    CHECK(id == STEAM && fakeCalls[2] == 1, "no launcher: GetSteamID is the player's own");
    len = 0; handle = ((GetAuthSessionTicket_t)uvt[13])(user, 0, ticket, sizeof ticket, &len);
    CHECK(handle == 7 && len == 11 && !memcmp(ticket, "STEAMTICKET", 11), "no launcher: ticket is the player's own");
    CHECK(!strcmp(((GetPersonaName_t)fvt[0])(friends, 0), "SteamName"), "no launcher: persona name is the player's own");

    /* 2. Launcher running, nothing armed: still the player's own. */
    CreateThread(NULL, 0, pipeServer, NULL, 0, NULL);
    Sleep(1200); /* identity cache: 1 s */
    mode = 0;
    ((GetSteamID_t)uvt[2])(user, 0, &id);
    CHECK(id == STEAM && requests >= 1, "not armed: launcher asked, player's own ID used");

    /* 3. Armed. */
    mode = 1; Sleep(1200);
    ((GetSteamID_t)uvt[2])(user, 0, &id);
    CHECK(id == BACKEND, "armed: GetSteamID is the backend ID");
    i = fakeCalls[13];
    len = 0; handle = ((GetAuthSessionTicket_t)uvt[13])(user, 0, ticket, sizeof ticket, &len);
    CHECK(len == sizeof envelope && !memcmp(ticket, envelope, sizeof envelope), "armed: ticket is the launcher's envelope");
    CHECK(fakeCalls[13] == i, "armed: Steam never asked for a ticket");
    i = fakeCalls[16];
    ((CancelAuthTicket_t)uvt[16])(user, 0, handle);
    CHECK(fakeCalls[16] == i, "our ticket handle is never cancelled at Steam");
    ((CancelAuthTicket_t)uvt[16])(user, 0, 7);
    CHECK(fakeCalls[16] == i + 1 && *fakeLastCancel == 7, "other handles still cancel at Steam");
    CHECK(!strcmp(((GetPersonaName_t)fvt[0])(friends, 0), "Website"), "armed: persona name is the website name");
    CHECK(!strcmp(((GetFriendPersonaName_t)fvt[7])(friends, 0, BACKEND), "Website"), "armed: own friend name is the website name");
    CHECK(!strcmp(((GetFriendPersonaName_t)fvt[7])(friends, 0, 123), "Friend"), "armed: other players' names untouched");

    /* 4. Armed but refused (ban, server gone): empty ticket, never the Steam one. */
    mode = 2;
    i = fakeCalls[13];
    len = 99; ((GetAuthSessionTicket_t)uvt[13])(user, 0, ticket, sizeof ticket, &len);
    CHECK(len == 0 && fakeCalls[13] == i, "refused: empty ticket, Steam not asked");

    /* 5. A second SteamUser() call keeps the same wrapped table. */
    CHECK(*(void ***)((Accessor_t)GetProcAddress(proxy, "SteamUser"))() == uvt, "wrapping is stable across calls");

    printf(failures ? "%d check(s) failed\n" : "all checks passed\n", failures);
    (void)fakeFriendCalls;
    return failures ? 1 : 0;
}
