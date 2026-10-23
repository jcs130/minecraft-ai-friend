/* Process-local GLFW bridge. Non-presentation imports retain system GDI.
 * Mesa is loaded by the deferred Java bridge, never by this DLL's loader. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
typedef BOOL (WINAPI *MesaSwapBuffers)(HDC);
BOOL WINAPI AgentMcSwapBuffers(HDC dc)
{
    HMODULE mesa = GetModuleHandleW(L"mesaGL32.dll");
    MesaSwapBuffers swap;
    if (!mesa) { SetLastError(ERROR_MOD_NOT_FOUND); return FALSE; }
    swap = (MesaSwapBuffers)GetProcAddress(mesa, "wglSwapBuffers");
    if (!swap) { SetLastError(ERROR_PROC_NOT_FOUND); return FALSE; }
    return swap(dc);
}
