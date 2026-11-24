// Wallpaper specs: a JSON file that describes a wallpaper instead of code. asciipaper writes one
// when it ports a picture, GIF or video, and people write them by hand for shader art:
//
//   {"shader": "media" | "art.glsl" | "vec4 cell(vec2 uv){...}",
//    "media": "the-chosen.mp4",          // played from "the-chosen.mp4.frames", made by asciipaper
//                                        // (or a .png, read as one still, no cache needed)
//    "charset": " .:-=+*#%@", "cell": 8, "aspect": 0.55, "maxCells": 40000,
//    "background": "#000000", "font": "JetBrains Mono, monospace", "fill": 0.15, "weight": 700,
//    "uniforms": {"contrast": 1.3, "tint": "#ff3355", "offset": [0, 0.1]}}
//
// A shader's first line may hold its defaults: // defaults: {"contrast": 1, ...}
#define _GNU_SOURCE
#include <fcntl.h>
#include <libgen.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cairo.h>
#include "engine.h"
#include "json.h"
#include "spec.h"

#define MAX_UNIFORMS 64

struct spec {
    struct preset preset;
    struct { char name[64]; int n; float v[4]; } uniforms[MAX_UNIFORMS];
    int nuniforms;
    const uint8_t *frames;   // after the 20-byte header, or a still decoded below
    uint8_t *still;          // a PNG read here, owned by this spec
    size_t mapped;
    int fw, fh, fcount;
    float fps;
    const struct preset *legacy;
};
static struct spec *current;

static char *read_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *text = malloc(n + 1);
    text[fread(text, 1, n, f)] = 0;
    fclose(f);
    return text;
}

static int hex_color(const char *s, float *rgb) {
    if (!s || s[0] != '#' || strlen(s) != 7 || strspn(s + 1, "0123456789abcdefABCDEF") != 6) return 0;
    for (int i = 0; i < 3; i++) { char b[3] = {s[1 + i * 2], s[2 + i * 2], 0}; rgb[i] = strtol(b, NULL, 16) / 255.f; }
    return 1;
}

// Add or replace uniform settings from a JSON object.
static void set_uniforms(struct spec *s, const struct json *object) {
    for (int i = 0; object && object->type == JSON_OBJECT && i < object->count; i++) {
        const struct json *v = object->items[i];
        float value[4] = {0};
        int n = 0;
        if (v->type == JSON_NUMBER || v->type == JSON_BOOL) value[n++] = v->number;
        else if (v->type == JSON_STRING && hex_color(v->string, value)) n = 3;
        else if (v->type == JSON_ARRAY)
            for (; n < v->count && n < 4; n++) value[n] = v->items[n]->type == JSON_NUMBER ? v->items[n]->number : 0;
        if (!n) { fprintf(stderr, "asciipaper-engine: ignoring uniform %s (use a number, [x, y], or \"#rrggbb\")\n", object->keys[i]); continue; }
        int k = 0;
        while (k < s->nuniforms && strcmp(s->uniforms[k].name, object->keys[i])) k++;
        if (k == MAX_UNIFORMS) break;
        if (k == s->nuniforms) { s->nuniforms++; snprintf(s->uniforms[k].name, sizeof s->uniforms[k].name, "%s", object->keys[i]); }
        s->uniforms[k].n = n;
        memcpy(s->uniforms[k].v, value, sizeof value);
    }
}

// Shared look indices, generated from looks.json.
#include "look_names.h"

static float named(const struct json *j, const char *key, const char *const *names) {
    const struct json *v = json_get(j, key);
    if (v && v->type == JSON_NUMBER) return v->number;
    for (int i = 0; v && v->type == JSON_STRING && names[i]; i++) if (!strcmp(names[i], v->string)) return i;
    return 0;
}

static float uniform(const struct spec *s, const char *name, float fallback) {
    for (int k = 0; k < s->nuniforms; k++) if (!strcmp(s->uniforms[k].name, name)) return s->uniforms[k].v[0];
    return fallback;
}

// frames file: "APF1", then little-endian u32 width, height, count, fps x 1000; then RGB frames.
static int map_frames(struct spec *s, const char *path) {
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    struct stat st;
    if (fd < 0 || fstat(fd, &st) < 0 || st.st_size < 20) {
        if (fd >= 0) close(fd);
        return 0;
    }
    const uint8_t *m = mmap(NULL, st.st_size, PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    if (m == MAP_FAILED) return 0;
    uint32_t h[4];
    memcpy(h, m + 4, sizeof h);
    // Divide rather than multiply the file size: a crafted header must not wrap the arithmetic.
    size_t frame_bytes = (size_t)h[0] * h[1] * 3;
    if (memcmp(m, "APF1", 4) || !h[0] || !h[1] || !h[2] || !frame_bytes || (size_t)(st.st_size - 20) / frame_bytes < h[2]) {
        fprintf(stderr, "asciipaper-engine: %s is not an asciipaper frames file\n", path);
        munmap((void *)m, st.st_size);
        return 0;
    }
    s->frames = m + 20; s->mapped = st.st_size;
    s->fw = h[0]; s->fh = h[1]; s->fcount = h[2]; s->fps = h[3] / 1000.f;
    return 1;
}

// A still picture needs no frame cache: cairo reads PNG, and a spec that points at one plays as a
// single frame. Atlases (asciimagic) depend on this: they are read one texel a cell, so nothing may
// resample them, and a 3-bytes-a-pixel cache of a 1728x1512 atlas is 7.8 MB of disk nobody needs.
static int load_still(struct spec *s, const char *path) {
    cairo_surface_t *surface = cairo_image_surface_create_from_png(path);
    if (cairo_surface_status(surface) != CAIRO_STATUS_SUCCESS) {
        cairo_surface_destroy(surface);
        fprintf(stderr, "asciipaper-engine: no frames for %s and cairo cannot read it as a PNG; "
                        "run python3 tools/import_media.py <media>\n", path);
        return 0;
    }
    cairo_surface_flush(surface);
    int w = cairo_image_surface_get_width(surface), h = cairo_image_surface_get_height(surface);
    unsigned char *data = cairo_image_surface_get_data(surface);
    int stride = cairo_image_surface_get_stride(surface);
    uint8_t *rgb = w > 0 && h > 0 ? malloc((size_t)w * h * 3) : NULL;
    if (!rgb) {
        fprintf(stderr, "asciipaper-engine: %s is %dx%d, which is not a picture the engine can use\n", path, w, h);
        cairo_surface_destroy(surface);
        return 0;
    }
    for (int y = 0; y < h; y++) {
        const uint32_t *row = (const uint32_t *)(data + (size_t)y * stride);
        for (int x = 0; x < w; x++) {
            uint32_t p = row[x], a = p >> 24;   // cairo's ARGB32 is a native 32-bit word, so this is endian-safe
            uint8_t *out = rgb + ((size_t)y * w + x) * 3;
            for (int k = 0; k < 3; k++) {
                uint32_t v = (p >> (16 - k * 8)) & 255;
                out[k] = a == 0 || a == 255 ? v : (uint8_t)fmin(255, (v * 255 + a / 2) / a);
            }
        }
    }
    cairo_surface_destroy(surface);
    s->frames = rgb; s->still = rgb;
    s->fw = w; s->fh = h; s->fcount = 1; s->fps = 1;
    return 1;
}

static void spec_update(struct scene *scene, float dt) {
    struct spec *s = current;
    if (s->legacy) {
        if (s->legacy->update) s->legacy->update(scene, dt);
        for (int k = 0; k < s->nuniforms; k++) scene_uniform(scene, s->uniforms[k].name, s->uniforms[k].n, s->uniforms[k].v);
        return;
    }
    for (int k = 0; k < s->nuniforms; k++) scene_uniform(scene, s->uniforms[k].name, s->uniforms[k].n, s->uniforms[k].v);
    if (!s->frames) {   // bind something, or a `media` sampler would read the frame being drawn
        static const uint8_t black[3];
        if (!scene->state) { scene->state = calloc(1, sizeof(long)); scene_texture(scene, "media", 1, 1, 3, black); }
        return;
    }
    float size[2] = {s->fw, s->fh};
    scene_uniform(scene, "mediaSize", 2, size);
    long frame = s->fcount > 1 ? (long)floor(scene->time * s->fps * uniform(s, "speed", 1)) % s->fcount : 0;
    if (frame < 0) frame += s->fcount;
    long *shown = scene->state ? scene->state : (scene->state = calloc(1, sizeof(long)));
    if (*shown == frame + 1) return;   // this monitor already has it (0 = nothing yet)
    *shown = frame + 1;
    scene_texture(scene, "media", s->fw, s->fh, 3, s->frames + (size_t)frame * s->fw * s->fh * 3);
}

const struct preset *spec_load(const char *path, const char *lib, char *shader_file, size_t shader_file_size) {
    char *text = read_file(path);
    struct json *j = text ? json_parse(text) : NULL;
    free(text);
    if (!j || j->type != JSON_OBJECT) {
        fprintf(stderr, "asciipaper-engine: %s is not a JSON object\n", path);
        json_free(j);
        return NULL;
    }
    char *copy = strdup(path), *dir = dirname(copy), file[4096];
    const char *media = json_string(j, "media", NULL);
    const char *shader = json_string(j, "shader", media ? "media" : NULL);
    char *glsl = NULL;
    shader_file[0] = 0;
    if (!shader) fprintf(stderr, "asciipaper-engine: %s needs a \"shader\" or \"media\"\n", path);
    else if (strchr(shader, '{')) glsl = strdup(shader);
    else {
        if (!strcmp(shader, "media")) snprintf(file, sizeof file, "%s/media.glsl", lib);
        else if (shader[0] == '/') snprintf(file, sizeof file, "%s", shader);
        else snprintf(file, sizeof file, "%s/%s", dir, shader);
        if (!(glsl = read_file(file))) fprintf(stderr, "asciipaper-engine: can't read shader %s\n", file);
        snprintf(shader_file, shader_file_size, "%s", file);
    }
    if (!glsl) { json_free(j); free(copy); return NULL; }

    struct spec *s = calloc(1, sizeof *s);
    const char *defaults = strstr(glsl, "// defaults:");
    if (defaults == glsl) {
        char *line = strndup(glsl + 12, strcspn(glsl + 12, "\n"));
        struct json *d = json_parse(line);
        set_uniforms(s, d);
        json_free(d); free(line);
    }
    set_uniforms(s, json_get(j, "uniforms"));
    const char *background = json_string(j, "background", "#000000");
    float rgb[3];
    s->preset = (struct preset){
        .name = "spec", .glsl = glsl, .update = spec_update,
        .charset = strdup(json_string(j, "charset", " .:-=+*#%@")),
        .font = json_string(j, "font", NULL) ? strdup(json_string(j, "font", NULL)) : NULL,
        .background = strdup(hex_color(background, rgb) ? background : "#000000"),
        .cell = fmax(1, json_number(j, "cell", 8)), .aspect = fmax(.1, json_number(j, "aspect", .55)),
        .max_cells = fmax(100, json_number(j, "maxCells", 40000)),
        .time = json_number(j, "time", 0), .period = json_number(j, "period", 0),
        .fill = fmin(1, fmax(0, json_number(j, "fill", 0))),
        .weight = fmin(900, fmax(0, json_number(j, "weight", 0))),
    };
    s->preset.shape = named(j, "shape", SHAPES);
    const char *scene = json_string(j, "scene", NULL);
    for (int i = 0; scene && presets[i]; i++) if (!strcmp(scene, presets[i]->name)) {
        s->legacy = presets[i];
        s->preset.resize = s->legacy->resize;
        s->preset.pointer_move = s->legacy->pointer_move;
        s->preset.pointer_down = s->legacy->pointer_down;
        s->preset.pointer_leave = s->legacy->pointer_leave;
        s->preset.lut = s->legacy->lut;
        if (!s->legacy->glsl) { free(glsl); s->preset.glsl = NULL; }
        break;
    }
    s->preset.dither = named(j, "dither", DITHERS);
    s->preset.pace = fmin(2, fmax(.05, json_number(j, "pace", 1)));
    const struct json *interaction = json_get(j, "interaction");   // "swirl" or {"mode": "swirl", "strength": .5, "radius": .12}
    int default_interaction = media ? 0 : 3;                      // pictures start still: faces should not bend
    if (interaction && interaction->type == JSON_OBJECT) {
        s->preset.interact = json_get(interaction, "mode") ? named(interaction, "mode", INTERACTIONS) : default_interaction;
        s->preset.interact_strength = json_number(interaction, "strength", .5);
        s->preset.interact_radius = json_number(interaction, "radius", .12);
    } else {
        s->preset.interact = interaction ? named(j, "interaction", INTERACTIONS) : default_interaction;
        s->preset.interact_strength = .5; s->preset.interact_radius = .12;
    }
    const struct json *palette = json_get(j, "palette");
    for (int i = 0; palette && palette->type == JSON_ARRAY && i < palette->count && s->preset.npalette < 16; i++)
        if (palette->items[i]->type == JSON_STRING && hex_color(palette->items[i]->string, s->preset.palette + s->preset.npalette * 3))
            s->preset.npalette++;
    const struct json *fx = json_get(j, "effects");
    for (int i = 0; FX[i]; i++) {
        const struct json *v = fx && fx->type == JSON_OBJECT ? json_get(fx, FX[i]) : NULL;
        s->preset.fx[i] = v && (v->type == JSON_NUMBER || v->type == JSON_BOOL) ? v->number : 0;
    }
    if (!*s->preset.charset) { free((char *)s->preset.charset); s->preset.charset = strdup(" @"); }
    if (media) {
        char media_path[4080];
        if (media[0] == '/') snprintf(media_path, sizeof media_path, "%s", media);
        else snprintf(media_path, sizeof media_path, "%s/%s", dir, media);
        snprintf(file, sizeof file, "%s.frames", media_path);
        if (!map_frames(s, file)) load_still(s, media_path);   // a PNG plays as it is
    }
    json_free(j); free(copy);
    return &s->preset;
}

// ponytail: the previous spec is kept (not freed) after a reload; a few KB per edit.
void spec_use(const struct preset *preset) {
    // Every edit reloads the spec. The buffers belong to the spec that stopped being current, and
    // nothing else reads them once the switch has happened (spec_update copies them into a texture).
    static struct spec *previous;
    if (previous && previous != (struct spec *)preset) {
        if (previous->still) free(previous->still);
        if (previous->mapped) munmap((void *)(previous->frames - 20), previous->mapped);
        previous->still = NULL;
        previous->mapped = 0;
        free(previous);
    }
    previous = (struct spec *)preset;
    current = (struct spec *)preset;
}
