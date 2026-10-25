/* Fingers on a touch screen for the test rig (dev/rig.sh gtktouch): a window of WebKitGTK — the application's web view on
 * Linux — that opens a page and hands it touches of the seat's touch screen, as GTK hands them to the application's
 * window, from a script. What WebKitGTK makes of fingers (pointers of a mouse after a tap, wheels of its own under a finger,
 * the page made larger under two) is only there with a touch screen's touches: made-up DOM events, or Chromium's, show none
 * of it. A seat without a touch screen: it says so and stops (exit 3).
 *   gtktouch URL SCRIPT      SCRIPT: a line each —
 *     size W H        the window's size (before the page opens)
 *     d ID X Y        a finger (0…9) comes down at X Y (in the window)    m ID X Y   it moves there    u ID   it leaves
 *     w MS            wait (a touch line waits for nothing: put "w 16" between the steps of a move)
 *     js CODE         the page runs CODE (an expression; a promise is waited for) and its value is printed: "= JSON"
 *     q               the end
 * Two fingers pulled apart are taken as the application takes them (src-tauri/src/host.rs: a GestureZoom in the capture
 * phase that hands a touchpad's pinch to MdView.pinch); CLAIM=1 takes those on a touch screen too, as it did before
 * 2026-10-24. The page's console is printed. */
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdio.h>
#include <string.h>

static GtkWidget *win, *wv;
static GdkDevice *touch;
static char **lines;
static int at, n;
static void next(void);

static void finger(GdkEventType type, int id, double x, double y) {
  static double last[10][2];
  if (type == GDK_TOUCH_END) { x = last[id][0]; y = last[id][1]; } else { last[id][0] = x; last[id][1] = y; }
  GdkWindow *w = gtk_widget_get_window(wv);
  GdkEvent *e = gdk_event_new(type);
  int ox, oy;
  gdk_window_get_origin(w, &ox, &oy);
  e->touch.window = g_object_ref(w);
  e->touch.time = (guint32)(g_get_monotonic_time() / 1000);
  e->touch.x = x; e->touch.y = y; e->touch.x_root = x + ox; e->touch.y_root = y + oy;
  e->touch.sequence = GINT_TO_POINTER(id + 1);
  e->touch.emulating_pointer = id == 0; // (GDK's own: the first finger down, as Wayland's touches come)
  gdk_event_set_device(e, touch);
  gdk_event_set_source_device(e, touch);
  gtk_main_do_event(e);
  e->touch.sequence = NULL; // (not GDK's to free)
  gdk_event_free(e);
}

static gboolean later(gpointer u) { (void)u; next(); return G_SOURCE_REMOVE; }
static void ranCall(GObject *o, GAsyncResult *r, gpointer u) {
  (void)u;
  GError *err = NULL;
  JSCValue *v = webkit_web_view_call_async_javascript_function_finish(WEBKIT_WEB_VIEW(o), r, &err);
  if (err) { char *m = g_strescape(err->message, NULL); printf("= {\"error\": \"%s\"}\n", m); g_free(m); g_error_free(err); }
  else { char *s = jsc_value_to_json(v, 0); printf("= %s\n", s ? s : "null"); g_free(s); }
  fflush(stdout);
  next();
}

static void next(void) {
  while (at < n) {
    char *l = lines[at++];
    int id; double x, y; unsigned ms;
    if (sscanf(l, "d %d %lf %lf", &id, &x, &y) == 3) finger(GDK_TOUCH_BEGIN, id, x, y);
    else if (sscanf(l, "m %d %lf %lf", &id, &x, &y) == 3) finger(GDK_TOUCH_UPDATE, id, x, y);
    else if (sscanf(l, "u %d", &id) == 1) finger(GDK_TOUCH_END, id, 0, 0);
    else if (sscanf(l, "w %u", &ms) == 1) { g_timeout_add(ms, later, NULL); return; }
    else if (!strncmp(l, "js ", 3)) {
      // (an expression of the page's, its promise waited for)
      char *body = g_strdup_printf("return await (%s);", l + 3);
      webkit_web_view_call_async_javascript_function(WEBKIT_WEB_VIEW(wv), body, -1, NULL, NULL, NULL, NULL, ranCall, NULL);
      g_free(body);
      return;
    }
    else if (!strcmp(l, "q")) { gtk_main_quit(); return; }
  }
  gtk_main_quit();
}

static gboolean begin(gpointer u) { (void)u; next(); return G_SOURCE_REMOVE; }
static void loaded(WebKitWebView *v, WebKitLoadEvent ev, gpointer u) {
  (void)v; (void)u;
  if (ev == WEBKIT_LOAD_FINISHED) g_timeout_add(300, begin, NULL);
}
static void zoomBegin(GtkGesture *g, GdkEventSequence *seq, gpointer u) {
  (void)u;
  if (seq && !g_getenv("CLAIM")) { gtk_gesture_set_state(g, GTK_EVENT_SEQUENCE_DENIED); return; } // (as host.rs)
  gtk_gesture_set_state(g, GTK_EVENT_SEQUENCE_CLAIMED);
  webkit_web_view_evaluate_javascript(WEBKIT_WEB_VIEW(wv), "window.MdView && MdView.pinch && MdView.pinch('begin', 1)", -1, NULL, NULL, NULL, NULL, NULL);
}
static void zoomed(GtkGestureZoom *g, double scale, gpointer u) {
  (void)g; (void)u;
  char *js = g_strdup_printf("window.MdView && MdView.pinch && MdView.pinch('move', %f)", scale);
  webkit_web_view_evaluate_javascript(WEBKIT_WEB_VIEW(wv), js, -1, NULL, NULL, NULL, NULL, NULL);
  g_free(js);
}
static gboolean console(WebKitWebView *v, WebKitScriptDialog *d, gpointer u) { (void)v; (void)u; printf("alert %s\n", webkit_script_dialog_get_message(d)); return TRUE; }

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "gtktouch URL SCRIPT\n"); return 2; }
  gtk_init(&argc, &argv);
  GdkSeat *seat = gdk_display_get_default_seat(gdk_display_get_default());
  GList *ts = gdk_seat_get_slaves(seat, GDK_SEAT_CAPABILITY_TOUCH);
  if (ts) touch = ts->data;
  else {
    // (a seat without one — the rig's nested compositor has none: a touch screen of GDK's own kind, made here; GTK and
    // WebKitGTK ask only what kind of device it is)
    GType t = g_type_from_name("GdkWaylandDevice");
    if (!t) { printf("no touch screen on this seat\n"); return 3; }
    touch = g_object_new(t, "name", "gtktouch", "type", GDK_DEVICE_TYPE_SLAVE, "input-source", GDK_SOURCE_TOUCHSCREEN, "input-mode", GDK_MODE_SCREEN,
                         "has-cursor", FALSE, "display", gdk_display_get_default(), "device-manager", gdk_display_get_device_manager(gdk_display_get_default()), "seat", seat, NULL);
  }
  gchar *text = NULL;
  if (!g_file_get_contents(argv[2], &text, NULL, NULL)) { fprintf(stderr, "gtktouch: cannot read %s\n", argv[2]); return 2; }
  lines = g_strsplit(text, "\n", -1);
  n = g_strv_length(lines);
  int w = 1280, h = 860;
  while (at < n && sscanf(lines[at], "size %d %d", &w, &h) == 2) at++;
  win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_default_size(GTK_WINDOW(win), w, h);
  wv = webkit_web_view_new();
  WebKitSettings *s = webkit_web_view_get_settings(WEBKIT_WEB_VIEW(wv));
  webkit_settings_set_enable_write_console_messages_to_stdout(s, TRUE);
  webkit_settings_set_allow_file_access_from_file_urls(s, TRUE);
  webkit_settings_set_allow_universal_access_from_file_urls(s, TRUE);
  g_signal_connect(wv, "script-dialog", G_CALLBACK(console), NULL);
  gtk_widget_add_events(wv, GDK_TOUCHPAD_GESTURE_MASK);
  GtkGesture *z = gtk_gesture_zoom_new(wv);
  gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(z), GTK_PHASE_CAPTURE);
  g_signal_connect(z, "begin", G_CALLBACK(zoomBegin), NULL);
  g_signal_connect(z, "scale-changed", G_CALLBACK(zoomed), NULL);
  gtk_container_add(GTK_CONTAINER(win), wv);
  gtk_widget_show_all(win);
  g_signal_connect(wv, "load-changed", G_CALLBACK(loaded), NULL);
  webkit_web_view_load_uri(WEBKIT_WEB_VIEW(wv), argv[1]);
  gtk_main();
  return 0;
}
