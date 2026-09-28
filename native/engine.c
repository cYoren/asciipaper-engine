// asciipaper-engine: runs the built-in presets without WebKit. The same two-pass renderer as
// wallpapers/lib/asciipaper.js (a cell() shader per character, then glyphs from an atlas) on
// EGL + OpenGL ES 2, in a wlr-layer-shell background surface on every monitor. Works on any
// compositor with layer-shell: Hyprland, Sway, niri, KDE Plasma, river, Wayfire, labwc, COSMIC.
//
// usage: asciipaper-engine PRESET
//        asciipaper-engine --spec WALLPAPER.json --lib DIR   (DIR holds media.glsl; see spec.c)
//        ... --snapshot OUT.png [--size 1920x1080] [--seconds 3] [--pointer X,Y]
//            render offscreen, without a compositor: previews, thumbnails and tests.
// Settings come from $XDG_CONFIG_HOME/asciipaper/engine.json and are re-read when it changes.
// A line "pause [OUTPUT...]" on stdin sets which monitors stop drawing; the launcher sends these
// on Hyprland when a fullscreen window covers a monitor.
#define _GNU_SOURCE
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/inotify.h>
#include <sys/prctl.h>
#include <sys/timerfd.h>
#include <time.h>
#include <unistd.h>
#include <pango/pangocairo.h>
#include <wayland-client.h>
#include <wayland-egl.h>
#include "engine.h"
#include "spec.h"
#include "wlr-layer-shell-unstable-v1-client-protocol.h"
#include "fractional-scale-v1-client-protocol.h"
#include "viewporter-client-protocol.h"
#include "cursor-shape-v1-client-protocol.h"

// ---- Shaders, verbatim from lib/asciipaper.js.
static const char HEADER[] =
    "precision highp float;\nvarying vec2 v_uv;\n"
    "uniform float u_time, u_aspect, u_down, u_strength, u_idle;\n"
    "uniform vec2 u_grid, u_size, u_pointer, u_velocity;\nuniform vec3 u_clicks[8];\nuniform sampler2D u_data;\n";
static const char QUAD[] = "attribute vec2 p;varying vec2 v_uv;void main(){v_uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}";
static const char CELL_MAIN[] =
    "\nuniform sampler2D u_lut;uniform float u_glyphs,u_useLut;\n"
    "void main(){vec4 c=cell(vec2(v_uv.x,1.0-v_uv.y));float l=clamp(c.a,0.0,1.0);\n"
    "float g=u_useLut>0.5?texture2D(u_lut,vec2((floor(l*255.0+0.5)+0.5)/256.0,0.5)).a*255.0:floor(l*(u_glyphs-1.0)+0.5);\n"
    "gl_FragColor=vec4(g/255.0,clamp(c.rgb,0.0,1.0));}";
static const char GLYPHS[] =
    "precision highp float;varying vec2 v_uv;uniform sampler2D cells,atlas;uniform vec2 grid,cell,atlasSize;uniform float tile,pad,fill,glyphs;uniform vec3 bg;\n"
    "void main(){vec4 d=texture2D(cells,(floor(v_uv*grid)+0.5)/grid);vec2 l=fract(vec2(v_uv.x,1.0-v_uv.y)*grid);float g=floor(d.r*255.0+0.5);\n"
    "vec2 uv=(vec2(g*tile,0.0)+pad+l*cell)/atlasSize;vec3 under=bg+d.gba*fill*g/max(glyphs-1.0,1.0);\n"
    "gl_FragColor=vec4(mix(under,d.gba,texture2D(atlas,uv).a),1.0);}";
static const char CPU_CELL[] = "vec4 cell(vec2 uv){return texture2D(u_data,uv);}";
#define PAD 3
#define MAX_TEXTURES 4
#define MAX_CLICKS 8

struct output {
    struct wl_list link;
    uint32_t global;
    struct wl_output *wl;
    char name[64];
    struct wl_surface *surface;
    struct zwlr_layer_surface_v1 *layer;
    struct wp_viewport *viewport;
    struct wp_fractional_scale_v1 *fractional;
    struct wl_egl_window *egl_window;
    EGLSurface egl;
    int width, height, buf_w, buf_h;   // logical size; drawn size (scale x quality)
    double scale;
    int configured, dirty, frame_pending, paused;
    double last, previous;
    GLuint cells, atlas, data, fbo;
    float cell_w, cell_h, tile, atlas_w, atlas_h;
    struct { char name[32]; GLuint tex; int w, h; } textures[MAX_TEXTURES];
    int ntextures;
    struct pointer pointer;
    struct { float x, y; double time; } clicks[MAX_CLICKS];
    int nclicks;
    struct scene scene;
};

static const struct preset *P;
static struct wl_display *display;
static struct wl_compositor *compositor;
static struct zwlr_layer_shell_v1 *layer_shell;
static struct wp_fractional_scale_manager_v1 *fractional_manager;
static struct wp_viewporter *viewporter;
static struct wp_cursor_shape_manager_v1 *cursor_manager;
static struct wl_seat *seat;
static struct wl_pointer *wl_pointer;
static struct output *pointer_output;
static struct wl_list outputs;
static int globals_ready;

static EGLDisplay egl_display;
static EGLConfig egl_config;
static EGLContext egl_context;
static GLuint cell_prog, glyph_prog, lut_tex, quad;
static float background[3];
static const char *spec_path, *lib_dir = ".";
static char spec_shader[4096];   // the spec's shader file, when it has one
static const struct preset *pending;   // a reloaded spec waiting for a GL context to compile in
static const char *snapshot;           // render once to this PNG instead of running

static struct { double fps, idle_fps, quality, pointer; } options = {24, 12, 1, 1};
static char engine_json[4096];

static double now_seconds(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec / 1e9;
}

static double clampd(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

// engine.json is flat JSON written by the launcher; read the four numbers without a JSON library.
static int load_options(void) {
    char text[4096] = "";
    FILE *f = fopen(engine_json, "r");
    if (f) { text[fread(text, 1, sizeof text - 1, f)] = 0; fclose(f); }
    double quality = options.quality;
    const char *keys[] = {"\"fps\"", "\"idleFps\"", "\"quality\"", "\"pointer\""};
    double *values[] = {&options.fps, &options.idle_fps, &options.quality, &options.pointer};
    for (int i = 0; i < 4; i++) {
        char *at = strstr(text, keys[i]);
        if (at && (at = strchr(at, ':'))) *values[i] = strtod(at + 1, NULL);
    }
    options.fps = clampd(options.fps, 1, 60);
    options.idle_fps = clampd(options.idle_fps, 1, options.fps);
    options.quality = clampd(options.quality, .5, 2);
    options.pointer = clampd(options.pointer, 0, 2);
    return quality != options.quality;
}

// ---- GL helpers
// Compile and link; 0 (with the error on stderr) if the shader is broken.
static GLuint program(const char *const *parts, int n) {
    const char *vertex = QUAD;
    GLuint p = glCreateProgram(), shaders[2] = {glCreateShader(GL_VERTEX_SHADER), glCreateShader(GL_FRAGMENT_SHADER)};
    glShaderSource(shaders[0], 1, &vertex, NULL);
    glShaderSource(shaders[1], n, parts, NULL);
    GLint ok = 1;
    char log[4096];
    for (int i = 0; i < 2 && ok; i++) {
        glCompileShader(shaders[i]);
        glGetShaderiv(shaders[i], GL_COMPILE_STATUS, &ok);
        if (!ok) { glGetShaderInfoLog(shaders[i], sizeof log, NULL, log); fprintf(stderr, "asciipaper-engine: shader error:\n%s", log); }
        glAttachShader(p, shaders[i]);
    }
    if (ok) {
        glBindAttribLocation(p, 0, "p");
        glLinkProgram(p);
        glGetProgramiv(p, GL_LINK_STATUS, &ok);
        if (!ok) { glGetProgramInfoLog(p, sizeof log, NULL, log); fprintf(stderr, "asciipaper-engine: shader link error:\n%s", log); }
    }
    glDeleteShader(shaders[0]); glDeleteShader(shaders[1]);
    if (!ok) { glDeleteProgram(p); return 0; }
    return p;
}

static GLuint texture(GLenum filter) {
    GLuint t;
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
    return t;
}

static int glyph_count(const struct preset *p) {
    int n = 0;
    for (const char *c = p->charset; *c; c = g_utf8_next_char(c)) n++;
    return n > 256 ? 256 : n;
}

static uint8_t hex(const char *s) { char b[3] = {s[0], s[1], 0}; return strtol(b, NULL, 16); }

// Make `p` the preset being drawn: compile its cell program. Keeps the current one if it fails.
static int use_preset(const struct preset *p) {
    const char *parts[] = {HEADER, p->glsl ? p->glsl : CPU_CELL, CELL_MAIN};
    GLuint next = program(parts, 3);
    if (!next) return 0;
    if (cell_prog) glDeleteProgram(cell_prog);
    cell_prog = next;
    P = p;
    if (spec_path) spec_use(p);
    for (int i = 0; i < 3; i++) background[i] = hex(P->background + 1 + i * 2) / 255.f;
    glUseProgram(glyph_prog);
    glUniform3fv(glGetUniformLocation(glyph_prog, "bg"), 1, background);
    glUniform1f(glGetUniformLocation(glyph_prog, "fill"), P->fill);
    glUniform1f(glGetUniformLocation(glyph_prog, "glyphs"), glyph_count(P));
    glUseProgram(cell_prog);
    glUniform1i(glGetUniformLocation(cell_prog, "u_data"), 2);
    glUniform1i(glGetUniformLocation(cell_prog, "u_lut"), 3);
    glUniform1f(glGetUniformLocation(cell_prog, "u_glyphs"), glyph_count(P));
    glUniform1f(glGetUniformLocation(cell_prog, "u_useLut"), P->lut ? 1 : 0);
    if (P->lut) {
        glActiveTexture(GL_TEXTURE3);
        if (!lut_tex) lut_tex = texture(GL_NEAREST);
        glBindTexture(GL_TEXTURE_2D, lut_tex);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_ALPHA, 256, 1, 0, GL_ALPHA, GL_UNSIGNED_BYTE, P->lut);
    }
    return 1;
}

// First time a surface is current: what every monitor shares.
static void init_gl(void) {
    const char *glyph_parts[] = {GLYPHS};
    glyph_prog = program(glyph_parts, 1);
    static const float corners[] = {0, 0, 1, 0, 0, 1, 1, 1};
    glGenBuffers(1, &quad);
    glBindBuffer(GL_ARRAY_BUFFER, quad);
    glBufferData(GL_ARRAY_BUFFER, sizeof corners, corners, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glUseProgram(glyph_prog);
    glUniform1i(glGetUniformLocation(glyph_prog, "cells"), 0);
    glUniform1i(glGetUniformLocation(glyph_prog, "atlas"), 1);
    if (!use_preset(P)) exit(1);
}

// Glyphs rasterized at the exact cell size in drawn pixels, laid out as asciipaper.js does.
static void build_atlas(struct output *o) {
    int n = glyph_count(P), tile = (int)ceil(o->cell_w) + PAD * 2, w = tile * n, h = (int)ceil(o->cell_h) + PAD * 2;
    cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_A8, w, h);
    cairo_t *cr = cairo_create(surface);
    PangoLayout *layout = pango_cairo_create_layout(cr);
    PangoFontDescription *font = pango_font_description_from_string(P->font ? P->font : "JetBrains Mono, monospace");
    pango_font_description_set_absolute_size(font, .9 * fmin(o->cell_w / .55, o->cell_h) * PANGO_SCALE);
    if (P->weight) pango_font_description_set_weight(font, P->weight);
    pango_layout_set_font_description(layout, font);
    int i = 0;
    for (const char *c = P->charset; *c && i < n; c = g_utf8_next_char(c), i++) {
        PangoRectangle ink, logical;
        pango_layout_set_text(layout, c, g_utf8_next_char(c) - c);
        pango_layout_get_pixel_extents(layout, &ink, &logical);
        // textAlign center, textBaseline middle
        cairo_move_to(cr, i * tile + PAD + o->cell_w / 2 - logical.width / 2.0, PAD + o->cell_h / 2 - logical.height / 2.0);
        pango_cairo_show_layout(cr, layout);
    }
    cairo_surface_flush(surface);
    int stride = cairo_image_surface_get_stride(surface);
    uint8_t *pixels = malloc((size_t)w * h);
    for (int y = 0; y < h; y++) memcpy(pixels + (size_t)y * w, cairo_image_surface_get_data(surface) + (size_t)y * stride, w);
    glActiveTexture(GL_TEXTURE1);
    if (!o->atlas) o->atlas = texture(GL_LINEAR);
    glBindTexture(GL_TEXTURE_2D, o->atlas);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_ALPHA, w, h, 0, GL_ALPHA, GL_UNSIGNED_BYTE, pixels);
    free(pixels);
    o->tile = tile; o->atlas_w = w; o->atlas_h = h;
    pango_font_description_free(font); g_object_unref(layout); cairo_destroy(cr); cairo_surface_destroy(surface);
}

static void make_current(struct output *o) {
    if (!eglMakeCurrent(egl_display, o->egl, o->egl, egl_context)) {
        fprintf(stderr, "asciipaper-engine: eglMakeCurrent failed\n");
        exit(1);
    }
}

// (Re)size an output's buffers, grid and atlas: after configure, a scale change or a quality change.
static void setup(struct output *o) {
    double density = o->scale * options.quality;
    if (!viewporter) density = 1;   // without viewporter the buffer must match the logical size
    o->buf_w = fmax(1, round(o->width * density));
    o->buf_h = fmax(1, round(o->height * density));
    if (o->viewport) wp_viewport_set_destination(o->viewport, o->width, o->height);
    if (snapshot && !o->egl) {
        EGLint size[] = {EGL_WIDTH, o->buf_w, EGL_HEIGHT, o->buf_h, EGL_NONE};
        o->egl = eglCreatePbufferSurface(egl_display, egl_config, size);
        make_current(o);
        if (!glyph_prog) init_gl();
    } else if (snapshot) {
        make_current(o);
    } else if (!o->egl_window) {
        o->egl_window = wl_egl_window_create(o->surface, o->buf_w, o->buf_h);
        o->egl = eglCreateWindowSurface(egl_display, egl_config, (EGLNativeWindowType)o->egl_window, NULL);
        make_current(o);
        eglSwapInterval(egl_display, 0);   // pacing is ours; never block on vsync
        if (!glyph_prog) init_gl();
    } else {
        wl_egl_window_resize(o->egl_window, o->buf_w, o->buf_h, 0, 0);
        make_current(o);
    }
    if (pending) {   // a reloaded spec: compile it now that a context is current
        const struct preset *next = pending;
        pending = NULL;
        if (use_preset(next)) {
            struct output *each;
            wl_list_for_each(each, &outputs, link) {
                free(each->scene.state); each->scene.state = NULL;
                each->ntextures = 0;   // ponytail: the old textures leak on reload
                each->dirty = 1;
            }
        }
    }
    struct scene *s = &o->scene;
    s->width = o->width; s->height = o->height;
    double cell_w = fmax(P->cell, sqrt((double)o->width * o->height * P->aspect / (P->max_cells ? P->max_cells : 40000)));
    s->cols = fmax(1, floor(o->width / cell_w));
    s->rows = fmax(1, floor(o->height * P->aspect / cell_w));
    o->cell_w = (float)o->buf_w / s->cols; o->cell_h = (float)o->buf_h / s->rows;
    if (!P->glsl) {
        free(s->data);
        s->data = calloc((size_t)s->cols * s->rows * 4, 1);
        glActiveTexture(GL_TEXTURE2);
        if (!o->data) o->data = texture(GL_NEAREST);
        glBindTexture(GL_TEXTURE_2D, o->data);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, s->cols, s->rows, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    }
    glActiveTexture(GL_TEXTURE0);
    if (!o->cells) { o->cells = texture(GL_NEAREST); glGenFramebuffers(1, &o->fbo); }
    glBindTexture(GL_TEXTURE_2D, o->cells);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, s->cols, s->rows, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glBindFramebuffer(GL_FRAMEBUFFER, o->fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, o->cells, 0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    build_atlas(o);
    glUseProgram(cell_prog);
    if (P->resize) P->resize(s);
    o->dirty = 0;
}

void scene_uniform(struct scene *s, const char *name, int n, const float *v) {
    GLint at = glGetUniformLocation(cell_prog, name);
    if (n == 1) glUniform1fv(at, 1, v);
    else if (n == 2) glUniform2fv(at, 1, v);
    else if (n == 3) glUniform3fv(at, 1, v);
    else glUniform4fv(at, 1, v);
}

void scene_texture(struct scene *s, const char *name, int w, int h, int channels, const uint8_t *pixels) {
    GLenum format = channels == 3 ? GL_RGB : GL_RGBA;
    struct output *o = s->output;
    int i = 0;
    while (i < o->ntextures && strcmp(o->textures[i].name, name)) i++;
    if (i == MAX_TEXTURES) return;
    glActiveTexture(GL_TEXTURE4 + i);
    if (i == o->ntextures) {
        o->ntextures++;
        snprintf(o->textures[i].name, sizeof o->textures[i].name, "%s", name);
        o->textures[i].tex = texture(GL_LINEAR);
    }
    glBindTexture(GL_TEXTURE_2D, o->textures[i].tex);
    if (o->textures[i].w == w && o->textures[i].h == h)
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, format, GL_UNSIGNED_BYTE, pixels);
    else {
        glTexImage2D(GL_TEXTURE_2D, 0, format, w, h, 0, format, GL_UNSIGNED_BYTE, pixels);
        o->textures[i].w = w; o->textures[i].h = h;
    }
    glUniform1i(glGetUniformLocation(cell_prog, name), 4 + i);
}

static void frame_done(void *data, struct wl_callback *cb, uint32_t time) {
    ((struct output *)data)->frame_pending = 0;
    wl_callback_destroy(cb);
}
static const struct wl_callback_listener frame_listener = {frame_done};

static void draw(struct output *o, double now) {
    struct scene *s = &o->scene;
    make_current(o);
    float dt = o->previous ? fmin(.1, now - o->previous) : 1 / 60.f;
    o->previous = now;
    s->time = P->time + fmod(s->time - P->time + dt, P->period ? P->period : 2000 * M_PI);
    s->strength = options.pointer;
    // This monitor's textures onto the shared units.
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, o->cells);
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, o->atlas);
    if (o->data) { glActiveTexture(GL_TEXTURE2); glBindTexture(GL_TEXTURE_2D, o->data); }
    for (int i = 0; i < o->ntextures; i++) { glActiveTexture(GL_TEXTURE4 + i); glBindTexture(GL_TEXTURE_2D, o->textures[i].tex); }
    glUseProgram(cell_prog);
    if (P->update) P->update(s, dt);
    if (s->data) {
        glActiveTexture(GL_TEXTURE2);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, s->cols, s->rows, GL_RGBA, GL_UNSIGNED_BYTE, s->data);
    }
    float clicks[MAX_CLICKS * 3];
    for (int i = 0; i < MAX_CLICKS; i++) {
        clicks[i * 3] = i < o->nclicks ? o->clicks[i].x : 0;
        clicks[i * 3 + 1] = i < o->nclicks ? o->clicks[i].y : 0;
        clicks[i * 3 + 2] = i < o->nclicks ? now - o->clicks[i].time : 1e4;
    }
    struct pointer *p = &o->pointer;
    glUniform1f(glGetUniformLocation(cell_prog, "u_time"), s->time);
    glUniform2f(glGetUniformLocation(cell_prog, "u_grid"), s->cols, s->rows);
    glUniform2f(glGetUniformLocation(cell_prog, "u_size"), s->width, s->height);
    glUniform1f(glGetUniformLocation(cell_prog, "u_aspect"), (float)s->width / s->height);
    glUniform2f(glGetUniformLocation(cell_prog, "u_pointer"), p->x, p->y);
    glUniform2f(glGetUniformLocation(cell_prog, "u_velocity"), p->vx, p->vy);
    glUniform1f(glGetUniformLocation(cell_prog, "u_down"), p->down);
    glUniform1f(glGetUniformLocation(cell_prog, "u_strength"), options.pointer);
    glUniform1f(glGetUniformLocation(cell_prog, "u_idle"), now - p->moved);
    glUniform3fv(glGetUniformLocation(cell_prog, "u_clicks"), MAX_CLICKS, clicks);
    glBindFramebuffer(GL_FRAMEBUFFER, o->fbo);
    glViewport(0, 0, s->cols, s->rows);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, o->buf_w, o->buf_h);
    glUseProgram(glyph_prog);
    glUniform2f(glGetUniformLocation(glyph_prog, "grid"), s->cols, s->rows);
    glUniform2f(glGetUniformLocation(glyph_prog, "cell"), o->cell_w, o->cell_h);
    glUniform2f(glGetUniformLocation(glyph_prog, "atlasSize"), o->atlas_w, o->atlas_h);
    glUniform1f(glGetUniformLocation(glyph_prog, "tile"), o->tile);
    glUniform1f(glGetUniformLocation(glyph_prog, "pad"), PAD);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    // Ask to be told when the compositor shows this frame. Until then we don't draw another, so a
    // monitor the compositor isn't painting (asleep, covered) costs nothing.
    if (snapshot) return;
    wl_callback_add_listener(wl_surface_frame(o->surface), &frame_listener, o);
    o->frame_pending = 1;
    eglSwapBuffers(egl_display, o->egl);
}

static int active(const struct output *o, double now) { return now - o->pointer.moved < 2; }

// ---- Wayland: outputs and their background surfaces
static void layer_configure(void *data, struct zwlr_layer_surface_v1 *layer, uint32_t serial, uint32_t w, uint32_t h) {
    struct output *o = data;
    zwlr_layer_surface_v1_ack_configure(layer, serial);
    if (!o->configured || o->width != (int)w || o->height != (int)h) o->dirty = 1;
    o->width = w; o->height = h; o->configured = 1;
}

static void destroy_output(struct output *o) {
    if (pointer_output == o) pointer_output = NULL;
    if (o->egl) { eglMakeCurrent(egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT); eglDestroySurface(egl_display, o->egl); }
    if (o->egl_window) wl_egl_window_destroy(o->egl_window);
    if (o->fractional) wp_fractional_scale_v1_destroy(o->fractional);
    if (o->viewport) wp_viewport_destroy(o->viewport);
    if (o->layer) zwlr_layer_surface_v1_destroy(o->layer);
    if (o->surface) wl_surface_destroy(o->surface);
    wl_output_release(o->wl);
    wl_list_remove(&o->link);
    free(o->scene.data); free(o->scene.state);
    free(o);
    // ponytail: GL objects of a removed monitor leak until exit; monitors are unplugged rarely.
}

static void layer_closed(void *data, struct zwlr_layer_surface_v1 *layer) { destroy_output(data); }
static const struct zwlr_layer_surface_v1_listener layer_listener = {layer_configure, layer_closed};

static void preferred_scale(void *data, struct wp_fractional_scale_v1 *f, uint32_t scale) {
    struct output *o = data;
    if (o->scale != scale / 120.0) { o->scale = scale / 120.0; o->dirty = 1; }
}
static const struct wp_fractional_scale_v1_listener fractional_listener = {preferred_scale};

static void create_surface(struct output *o) {
    o->surface = wl_compositor_create_surface(compositor);
    o->layer = zwlr_layer_shell_v1_get_layer_surface(layer_shell, o->surface, o->wl,
                                                     ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND, "asciipaper");
    zwlr_layer_surface_v1_add_listener(o->layer, &layer_listener, o);
    zwlr_layer_surface_v1_set_anchor(o->layer, ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP | ZWLR_LAYER_SURFACE_V1_ANCHOR_BOTTOM |
                                                   ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT | ZWLR_LAYER_SURFACE_V1_ANCHOR_RIGHT);
    zwlr_layer_surface_v1_set_exclusive_zone(o->layer, -1);
    if (viewporter) o->viewport = wp_viewporter_get_viewport(viewporter, o->surface);
    if (fractional_manager) {
        o->fractional = wp_fractional_scale_manager_v1_get_fractional_scale(fractional_manager, o->surface);
        wp_fractional_scale_v1_add_listener(o->fractional, &fractional_listener, o);
    }
    wl_surface_commit(o->surface);
}

static void output_geometry(void *d, struct wl_output *w, int32_t x, int32_t y, int32_t pw, int32_t ph,
                            int32_t sp, const char *make, const char *model, int32_t tr) {}
static void output_mode(void *d, struct wl_output *w, uint32_t f, int32_t width, int32_t height, int32_t r) {}
static void output_done(void *d, struct wl_output *w) {}
static void output_scale(void *data, struct wl_output *w, int32_t factor) {
    struct output *o = data;
    if (!fractional_manager && o->scale != factor) { o->scale = factor; o->dirty = 1; }
}
static void output_name(void *data, struct wl_output *w, const char *name) {
    snprintf(((struct output *)data)->name, sizeof ((struct output *)data)->name, "%s", name);
}
static void output_description(void *d, struct wl_output *w, const char *desc) {}
static const struct wl_output_listener output_listener = {
    output_geometry, output_mode, output_done, output_scale, output_name, output_description};

// ---- Pointer: the desktop is wherever our surface is visible. Same state as asciipaper.js.
static void pointer_moved(struct output *o, wl_fixed_t sx, wl_fixed_t sy) {
    struct pointer *p = &o->pointer;
    double now = now_seconds(), dt = fmax(.001, now - p->moved);
    float x = wl_fixed_to_double(sx) / o->width, y = wl_fixed_to_double(sy) / o->height;
    if (dt < .25) { p->vx += ((x - p->x) / dt - p->vx) * .5f; p->vy += ((y - p->y) / dt - p->vy) * .5f; }
    p->x = x; p->y = y; p->inside = 1; p->moved = now;
    if (P->pointer_move && o->scene.state) P->pointer_move(&o->scene);
}

static void pointer_enter(void *d, struct wl_pointer *ptr, uint32_t serial, struct wl_surface *surface, wl_fixed_t sx, wl_fixed_t sy) {
    struct output *o;
    pointer_output = NULL;
    wl_list_for_each(o, &outputs, link) if (o->surface == surface) pointer_output = o;
    if (cursor_manager) {
        struct wp_cursor_shape_device_v1 *device = wp_cursor_shape_manager_v1_get_pointer(cursor_manager, ptr);
        wp_cursor_shape_device_v1_set_shape(device, serial, WP_CURSOR_SHAPE_DEVICE_V1_SHAPE_DEFAULT);
        wp_cursor_shape_device_v1_destroy(device);
    }
    if (pointer_output) pointer_moved(pointer_output, sx, sy);
}
static void pointer_leave(void *d, struct wl_pointer *ptr, uint32_t serial, struct wl_surface *surface) {
    struct output *o = pointer_output;
    pointer_output = NULL;
    if (!o) return;
    o->pointer.inside = o->pointer.down = 0;
    o->pointer.vx = o->pointer.vy = 0;
    if (P->pointer_leave && o->scene.state) P->pointer_leave(&o->scene);
}
static void pointer_motion(void *d, struct wl_pointer *ptr, uint32_t time, wl_fixed_t sx, wl_fixed_t sy) {
    if (pointer_output) pointer_moved(pointer_output, sx, sy);
}
static void pointer_button(void *d, struct wl_pointer *ptr, uint32_t serial, uint32_t time, uint32_t button, uint32_t state) {
    struct output *o = pointer_output;
    if (!o) return;
    o->pointer.down = state == WL_POINTER_BUTTON_STATE_PRESSED;
    if (!o->pointer.down) return;
    memmove(o->clicks + 1, o->clicks, sizeof o->clicks[0] * (MAX_CLICKS - 1));
    o->clicks[0].x = o->pointer.x; o->clicks[0].y = o->pointer.y; o->clicks[0].time = now_seconds();
    if (o->nclicks < MAX_CLICKS) o->nclicks++;
    if (P->pointer_down && o->scene.state) P->pointer_down(&o->scene);
}
static void pointer_axis(void *d, struct wl_pointer *ptr, uint32_t time, uint32_t axis, wl_fixed_t value) {}
static void pointer_frame(void *d, struct wl_pointer *ptr) {}
static void pointer_axis_source(void *d, struct wl_pointer *ptr, uint32_t source) {}
static void pointer_axis_stop(void *d, struct wl_pointer *ptr, uint32_t time, uint32_t axis) {}
static void pointer_axis_discrete(void *d, struct wl_pointer *ptr, uint32_t axis, int32_t discrete) {}
static const struct wl_pointer_listener pointer_listener = {
    pointer_enter, pointer_leave, pointer_motion, pointer_button, pointer_axis,
    pointer_frame, pointer_axis_source, pointer_axis_stop, pointer_axis_discrete};

static void seat_capabilities(void *d, struct wl_seat *s, uint32_t caps) {
    if (caps & WL_SEAT_CAPABILITY_POINTER && !wl_pointer) {
        wl_pointer = wl_seat_get_pointer(s);
        wl_pointer_add_listener(wl_pointer, &pointer_listener, NULL);
    } else if (!(caps & WL_SEAT_CAPABILITY_POINTER) && wl_pointer) {
        wl_pointer_release(wl_pointer);
        wl_pointer = NULL; pointer_output = NULL;
    }
}
static void seat_name(void *d, struct wl_seat *s, const char *name) {}
static const struct wl_seat_listener seat_listener = {seat_capabilities, seat_name};

static void global(void *data, struct wl_registry *reg, uint32_t name, const char *iface, uint32_t version) {
    if (!strcmp(iface, wl_compositor_interface.name))
        compositor = wl_registry_bind(reg, name, &wl_compositor_interface, 4);
    else if (!strcmp(iface, zwlr_layer_shell_v1_interface.name))
        layer_shell = wl_registry_bind(reg, name, &zwlr_layer_shell_v1_interface, 1);
    else if (!strcmp(iface, wp_fractional_scale_manager_v1_interface.name))
        fractional_manager = wl_registry_bind(reg, name, &wp_fractional_scale_manager_v1_interface, 1);
    else if (!strcmp(iface, wp_viewporter_interface.name))
        viewporter = wl_registry_bind(reg, name, &wp_viewporter_interface, 1);
    else if (!strcmp(iface, wp_cursor_shape_manager_v1_interface.name))
        cursor_manager = wl_registry_bind(reg, name, &wp_cursor_shape_manager_v1_interface, 1);
    else if (!strcmp(iface, wl_seat_interface.name) && !seat) {
        seat = wl_registry_bind(reg, name, &wl_seat_interface, version < 5 ? version : 5);
        wl_seat_add_listener(seat, &seat_listener, NULL);
    } else if (!strcmp(iface, wl_output_interface.name) && version >= 3) {
        struct output *o = calloc(1, sizeof *o);
        o->global = name; o->scale = 1; o->pointer.x = o->pointer.y = .5f; o->pointer.moved = -1e9;
        o->scene.output = o; o->scene.pointer = &o->pointer; o->scene.time = P->time;
        o->wl = wl_registry_bind(reg, name, &wl_output_interface, version < 4 ? version : 4);
        wl_output_add_listener(o->wl, &output_listener, o);
        wl_list_insert(outputs.prev, &o->link);
        if (globals_ready) create_surface(o);   // a monitor plugged in later
    }
}
static void global_remove(void *data, struct wl_registry *reg, uint32_t name) {
    struct output *o, *tmp;
    wl_list_for_each_safe(o, tmp, &outputs, link) if (o->global == name) destroy_output(o);
}
static const struct wl_registry_listener registry_listener = {global, global_remove};

// "pause eDP-1 HDMI-A-1": exactly these monitors stop drawing.
static void read_command(int fd) {
    static char buf[1024];
    static size_t len;
    ssize_t n = read(fd, buf + len, sizeof buf - 1 - len);
    if (n <= 0) { len = 0; return; }
    len += n; buf[len] = 0;
    char *line, *end;
    while ((end = strchr(buf, '\n'))) {
        *end = 0; line = buf;
        if (!strncmp(line, "pause", 5)) {
            struct output *o;
            wl_list_for_each(o, &outputs, link) {
                char names[sizeof buf];
                snprintf(names, sizeof names, "%s", line + 5);
                o->paused = 0;
                for (char *save, *word = strtok_r(names, " ", &save); word; word = strtok_r(NULL, " ", &save))
                    if (!strcmp(word, o->name)) o->paused = 1;
            }
        }
        memmove(buf, end + 1, len - (end + 1 - buf) + 1);
        len -= end + 1 - buf;
    }
    if (len == sizeof buf - 1) len = 0;   // a line too long to be ours
}

static void arm(int timer, double fps) {
    long ns = fps ? 1e9 / fps : 0;
    timerfd_settime(timer, 0, &(struct itimerspec){{ns / 1000000000L, ns % 1000000000L}, {0, ns ? 1 : 0}}, NULL);
}

// --snapshot: one virtual monitor on a pbuffer, simulated for a few seconds at 30 fps, saved as PNG.
static int take_snapshot(int width, int height, double seconds, float px, float py) {
    egl_display = eglGetPlatformDisplay(0x31DD /* EGL_PLATFORM_SURFACELESS_MESA */, EGL_DEFAULT_DISPLAY, NULL);
    EGLint count;
    static const EGLint config_attribs[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                                            EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
    static const EGLint context_attribs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    if (!egl_display || !eglInitialize(egl_display, NULL, NULL) || !eglBindAPI(EGL_OPENGL_ES_API) ||
        !eglChooseConfig(egl_display, config_attribs, &egl_config, 1, &count) || !count ||
        !(egl_context = eglCreateContext(egl_display, egl_config, EGL_NO_CONTEXT, context_attribs))) {
        fprintf(stderr, "asciipaper-engine: no offscreen OpenGL ES 2 (EGL surfaceless)\n");
        return 1;
    }
    struct output *o = calloc(1, sizeof *o);
    o->scale = 1; o->width = width; o->height = height; o->configured = 1;
    o->pointer.x = px; o->pointer.y = py; o->pointer.moved = -1e9;
    o->scene.output = o; o->scene.pointer = &o->pointer; o->scene.time = P->time;
    wl_list_insert(&outputs, &o->link);
    setup(o);
    int frames = fmax(1, seconds * 30);
    for (int i = 0; i < frames; i++) {
        double now = i / 30.0;
        if (px >= 0) { o->pointer.inside = 1; o->pointer.moved = now; if (P->pointer_move && o->scene.state) P->pointer_move(&o->scene); }
        draw(o, now);
    }
    uint8_t *rgba = malloc((size_t)o->buf_w * o->buf_h * 4);
    glReadPixels(0, 0, o->buf_w, o->buf_h, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    cairo_surface_t *image = cairo_image_surface_create(CAIRO_FORMAT_RGB24, o->buf_w, o->buf_h);
    uint32_t *out = (uint32_t *)cairo_image_surface_get_data(image);
    int stride = cairo_image_surface_get_stride(image) / 4;
    for (int y = 0; y < o->buf_h; y++)   // GL rows start at the bottom
        for (int x = 0; x < o->buf_w; x++) {
            const uint8_t *p = rgba + ((size_t)(o->buf_h - 1 - y) * o->buf_w + x) * 4;
            out[y * stride + x] = (uint32_t)p[0] << 16 | p[1] << 8 | p[2];
        }
    cairo_surface_mark_dirty(image);
    cairo_status_t status = cairo_surface_write_to_png(image, snapshot);
    cairo_surface_destroy(image); free(rgba);
    if (status != CAIRO_STATUS_SUCCESS) { fprintf(stderr, "asciipaper-engine: can't write %s\n", snapshot); return 1; }
    return 0;
}

static void usage(const char *argv0) {
    fprintf(stderr, "usage: %s PRESET | --spec WALLPAPER.json [--lib DIR]\n"
                    "       [--snapshot OUT.png [--size WxH] [--seconds S] [--pointer X,Y]]\npresets:", argv0);
    for (int i = 0; presets[i]; i++) fprintf(stderr, " %s", presets[i]->name);
    fputc('\n', stderr);
    exit(2);
}

int main(int argc, char **argv) {
    int snap_w = 1920, snap_h = 1080;
    double snap_seconds = 3;
    float snap_x = -1, snap_y = -1;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--spec") && i + 1 < argc) spec_path = argv[++i];
        else if (!strcmp(argv[i], "--snapshot") && i + 1 < argc) snapshot = argv[++i];
        else if (!strcmp(argv[i], "--size") && i + 1 < argc) sscanf(argv[++i], "%dx%d", &snap_w, &snap_h);
        else if (!strcmp(argv[i], "--seconds") && i + 1 < argc) snap_seconds = atof(argv[++i]);
        else if (!strcmp(argv[i], "--pointer") && i + 1 < argc) sscanf(argv[++i], "%f,%f", &snap_x, &snap_y);
        else if (!strcmp(argv[i], "--lib") && i + 1 < argc) lib_dir = argv[++i];
        else for (int k = 0; presets[k]; k++) if (!strcmp(presets[k]->name, argv[i])) P = presets[k];
    }
    if (spec_path && !(P = spec_load(spec_path, lib_dir, spec_shader, sizeof spec_shader))) return 1;
    if (!P) usage(argv[0]);
    prctl(PR_SET_PDEATHSIG, SIGTERM);   // leave with the launcher
    const char *config = getenv("XDG_CONFIG_HOME"), *home = getenv("HOME");
    char dir[4000];
    snprintf(dir, sizeof dir, config && *config ? "%s/asciipaper" : "%s/.config/asciipaper", config && *config ? config : home);
    snprintf(engine_json, sizeof engine_json, "%s/engine.json", dir);
    load_options();

    wl_list_init(&outputs);
    if (snapshot) {
        options.quality = 1;
        return take_snapshot(fmax(16, snap_w), fmax(16, snap_h), snap_seconds, snap_x, snap_y);
    }
    display = wl_display_connect(NULL);
    if (!display) { fprintf(stderr, "asciipaper-engine: no Wayland display\n"); return 1; }
    struct wl_registry *registry = wl_display_get_registry(display);
    wl_registry_add_listener(registry, &registry_listener, NULL);
    wl_display_roundtrip(display);
    if (!compositor || !layer_shell) {
        fprintf(stderr, "asciipaper-engine: this compositor has no wlr-layer-shell, so wallpapers can't be drawn\n");
        return 1;
    }
    egl_display = eglGetDisplay((EGLNativeDisplayType)display);
    EGLint count;
    static const EGLint config_attribs[] = {EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                                            EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
    static const EGLint context_attribs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    if (!eglInitialize(egl_display, NULL, NULL) || !eglBindAPI(EGL_OPENGL_ES_API) ||
        !eglChooseConfig(egl_display, config_attribs, &egl_config, 1, &count) || !count ||
        !(egl_context = eglCreateContext(egl_display, egl_config, EGL_NO_CONTEXT, context_attribs))) {
        fprintf(stderr, "asciipaper-engine: no OpenGL ES 2 through EGL\n");
        return 1;
    }
    globals_ready = 1;
    struct output *o, *tmp;
    wl_list_for_each(o, &outputs, link) create_surface(o);

    int timer = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC), rate = 0;
    int watch = inotify_init1(IN_CLOEXEC | IN_NONBLOCK);
    inotify_add_watch(watch, dir, IN_CLOSE_WRITE | IN_MOVED_TO);
    char spec_dir[4096] = "", shader_dir[4096] = "";
    if (spec_path) {   // edits to the spec or its shader file show up live
        snprintf(spec_dir, sizeof spec_dir, "%s", spec_path);
        *(strrchr(spec_dir, '/') ? strrchr(spec_dir, '/') : spec_dir) = 0;
        inotify_add_watch(watch, *spec_dir ? spec_dir : ".", IN_CLOSE_WRITE | IN_MOVED_TO);
        snprintf(shader_dir, sizeof shader_dir, "%s", spec_shader);
        if (strrchr(shader_dir, '/')) { *strrchr(shader_dir, '/') = 0; inotify_add_watch(watch, shader_dir, IN_CLOSE_WRITE | IN_MOVED_TO); }
    }
    struct pollfd fds[4] = {{wl_display_get_fd(display), POLLIN}, {timer, POLLIN}, {watch, POLLIN}, {0, POLLIN}};
    for (;;) {
        // Outputs that were just configured (or changed size or scale) draw right away.
        double now = now_seconds();
        wl_list_for_each_safe(o, tmp, &outputs, link) if (o->configured && o->dirty) { setup(o); draw(o, now); }
        int want = 0;   // 0 disarms the timer: nothing to draw, so don't wake up at all
        wl_list_for_each(o, &outputs, link)
            if (o->configured && !o->paused) want = fmax(want, active(o, now) ? options.fps : options.idle_fps);
        if (want != rate) arm(timer, rate = want);

        while (wl_display_prepare_read(display)) wl_display_dispatch_pending(display);
        wl_display_flush(display);
        if (poll(fds, 4, -1) < 0) { wl_display_cancel_read(display); continue; }
        if (fds[0].revents & POLLIN) wl_display_read_events(display); else wl_display_cancel_read(display);
        if (fds[0].revents & (POLLHUP | POLLERR)) return 0;   // compositor gone
        wl_display_dispatch_pending(display);
        if (fds[3].revents & POLLIN) read_command(0);
        if (fds[3].revents & (POLLHUP | POLLERR)) fds[3].fd = -1;
        if (fds[2].revents & POLLIN) {
            char events[4096] __attribute__((aligned(__alignof__(struct inotify_event))));
            ssize_t n = read(watch, events, sizeof events);
            int options_changed = 0, spec_changed = 0;
            for (char *e = events; n > 0 && e < events + n; e += sizeof(struct inotify_event) + ((struct inotify_event *)e)->len) {
                const char *name = ((struct inotify_event *)e)->len ? ((struct inotify_event *)e)->name : "";
                if (!strcmp(name, "engine.json")) options_changed = 1;
                const char *spec_name = spec_path ? (strrchr(spec_path, '/') ? strrchr(spec_path, '/') + 1 : spec_path) : NULL;
                const char *shader_name = strrchr(spec_shader, '/') ? strrchr(spec_shader, '/') + 1 : NULL;
                if ((spec_name && !strcmp(name, spec_name)) || (shader_name && !strcmp(name, shader_name))) spec_changed = 1;
            }
            if (options_changed && load_options())
                wl_list_for_each(o, &outputs, link) o->dirty = 1;   // quality changed: new buffer size
            if (spec_changed) {
                const struct preset *next = spec_load(spec_path, lib_dir, spec_shader, sizeof spec_shader);
                if (next) {
                    pending = next;
                    wl_list_for_each(o, &outputs, link) o->dirty = 1;   // setup() compiles it
                }
            }
        }
        if (fds[1].revents & POLLIN) {
            uint64_t ticks;
            if (read(timer, &ticks, sizeof ticks) < 0) continue;
            now = now_seconds();
            wl_list_for_each(o, &outputs, link) {
                if (!o->configured || o->dirty || o->paused || o->frame_pending) continue;
                if (now - o->last >= 1 / (active(o, now) ? options.fps : options.idle_fps) - .002) { o->last = now; draw(o, now); }
            }
        }
    }
}
