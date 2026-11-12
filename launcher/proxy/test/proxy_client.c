/* End-to-end helper for launcher/host/test: loads the proxy (with fake_upstream.c as steam_api_upstream.dll) the way
   the game would, then prints what librust.dll would send in DoConnect:
     id=<GetSteamID> len=<ticket length> ticket=<hex> name=<GetPersonaName>
   The C# test runs it against the real TicketPipe (pipe name in RLB_LAUNCHER_PIPE). */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

typedef unsigned long long u64;
typedef unsigned int u32;
typedef u64 *(__fastcall *GetSteamID_t)(void *self, void *edx, u64 *out);
typedef u32 (__fastcall *GetAuthSessionTicket_t)(void *self, void *edx, void *ticket, int cbMax, u32 *pcb);
typedef const char *(__fastcall *GetPersonaName_t)(void *self, void *edx);
typedef void *(__cdecl *Accessor_t)(void);

int main(void)
{
    HMODULE proxy = LoadLibraryW(L"steam_api.dll");
    void *user, *friends;
    u64 id = 0;
    unsigned char ticket[1024];
    u32 len = 0, i;
    if (!proxy || !GetProcAddress(proxy, "SteamAPI_Init")) { printf("error=load\n"); return 2; }
    user = ((Accessor_t)GetProcAddress(proxy, "SteamUser"))();
    friends = ((Accessor_t)GetProcAddress(proxy, "SteamFriends"))();
    /* DoConnect order: Steam_GetSteamID (0 check), SteamClient_GetAuth, then Steam_GetSteamID into the login. */
    ((GetSteamID_t)(*(void ***)user)[2])(user, 0, &id);
    ((GetAuthSessionTicket_t)(*(void ***)user)[13])(user, 0, ticket, sizeof ticket, &len);
    ((GetSteamID_t)(*(void ***)user)[2])(user, 0, &id);
    printf("id=%llu len=%u ticket=", id, len);
    for (i = 0; i < len; i++) printf("%02x", ticket[i]);
    printf(" name=%s\n", ((GetPersonaName_t)(*(void ***)friends)[0])(friends, 0));
    return 0;
}
