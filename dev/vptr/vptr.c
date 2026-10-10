/* A real pointer for the test rig (dev/rig.sh): moves and presses a virtual pointer in the compositor named by
 * WAYLAND_DISPLAY — the nested one the rig runs the app in — so that what the browser itself does with a held button
 * (selecting text, dragging, scrolling after it) is part of a check. Made-up DOM events prove none of that.
 *   vptr W H  m X Y | d | u | s MS | g X Y STEPS MS   …
 * W H: the output's size; m: move to; d/u: left button down/up; s: sleep; g: glide to X Y in STEPS, MS between them. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>
#include "vp.h"

static struct zwlr_virtual_pointer_manager_v1 *manager;
static void global(void *d, struct wl_registry *r, uint32_t name, const char *iface, uint32_t v) {
  (void)d; (void)v;
  if (!strcmp(iface, zwlr_virtual_pointer_manager_v1_interface.name)) manager = wl_registry_bind(r, name, &zwlr_virtual_pointer_manager_v1_interface, 1);
}
static void gone(void *d, struct wl_registry *r, uint32_t name) { (void)d; (void)r; (void)name; }
static const struct wl_registry_listener listener = { global, gone };
static uint32_t now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (uint32_t)(t.tv_sec * 1000 + t.tv_nsec / 1000000); }

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "vptr W H commands…\n"); return 2; }
  struct wl_display *dpy = wl_display_connect(NULL);
  if (!dpy) { fprintf(stderr, "vptr: no display\n"); return 1; }
  struct wl_registry *reg = wl_display_get_registry(dpy);
  wl_registry_add_listener(reg, &listener, NULL);
  wl_display_roundtrip(dpy);
  if (!manager) { fprintf(stderr, "vptr: the compositor has no virtual pointer\n"); return 1; }
  struct zwlr_virtual_pointer_v1 *p = zwlr_virtual_pointer_manager_v1_create_virtual_pointer(manager, NULL);
  uint32_t W = (uint32_t)atoi(argv[1]), H = (uint32_t)atoi(argv[2]);
  double x = 0, y = 0;
  #define MOVE(nx, ny) do { x = (nx); y = (ny); zwlr_virtual_pointer_v1_motion_absolute(p, now(), (uint32_t)(x + 0.5), (uint32_t)(y + 0.5), W, H); zwlr_virtual_pointer_v1_frame(p); wl_display_roundtrip(dpy); } while (0)
  for (int i = 3; i < argc; i++) {
    const char *c = argv[i];
    if (!strcmp(c, "m") && i + 2 < argc) { MOVE(atof(argv[i + 1]), atof(argv[i + 2])); i += 2; }
    else if (!strcmp(c, "g") && i + 4 < argc) {
      double tx = atof(argv[i + 1]), ty = atof(argv[i + 2]), sx = x, sy = y; int n = atoi(argv[i + 3]), ms = atoi(argv[i + 4]);
      for (int k = 1; k <= n; k++) { MOVE(sx + (tx - sx) * k / n, sy + (ty - sy) * k / n); usleep(ms * 1000); }
      i += 4;
    }
    else if (!strcmp(c, "d") || !strcmp(c, "u")) { zwlr_virtual_pointer_v1_button(p, now(), 0x110, c[0] == 'd'); zwlr_virtual_pointer_v1_frame(p); wl_display_roundtrip(dpy); }
    else if (!strcmp(c, "s") && i + 1 < argc) { usleep(atoi(argv[++i]) * 1000); }
    else { fprintf(stderr, "vptr: what is %s?\n", c); return 2; }
  }
  zwlr_virtual_pointer_v1_destroy(p);
  wl_display_roundtrip(dpy);
  return 0;
}
