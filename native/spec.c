// Wallpaper specs: a JSON file that describes a wallpaper instead of code. asciipaper writes one
// when it ports a picture, GIF or video, and people write them by hand for shader art:
//
//   {"shader": "media" | "art.glsl" | "vec4 cell(vec2 uv){...}",
//    "media": "the-chosen.mp4",          // played from "the-chosen.mp4.frames", made by asciipaper
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
#include "engine.h"
#include "json.h"
#include "spec.h"

#define MAX_UNIFORMS 64

struct spec {
    struct preset preset;
    struct { char name[64]; int n; float v[4]; } uniforms[MAX_UNIFORMS];
    int nuniforms;
    const uint8_t *frames;   // after the 20-byte header
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
static void map_frames(struct spec *s, const char *path) {
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    struct stat st;
    if (fd < 0 || fstat(fd, &st) < 0 || st.st_size < 20) {
        fprintf(stderr, "asciipaper-engine: no frames at %s; run: asciipaper import <media>\n", path);
        if (fd >= 0) close(fd);
        return;
    }
    const uint8_t *m = mmap(NULL, st.st_size, PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    if (m == MAP_FAILED) return;
    uint32_t h[4];
    memcpy(h, m + 4, sizeof h);
    if (memcmp(m, "APF1", 4) || !h[0] || !h[1] || !h[2] || 20 + (size_t)h[0] * h[1] * 3 * h[2] > (size_t)st.st_size) {
        fprintf(stderr, "asciipaper-engine: %s is not an asciipaper frames file\n", path);
        munmap((void *)m, st.st_size);
        return;
    }
    s->frames = m + 20; s->mapped = st.st_size;
    s->fw = h[0]; s->fh = h[1]; s->fcount = h[2]; s->fps = h[3] / 1000.f;
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
        .cell = fmax(2, json_number(j, "cell", 8)), .aspect = fmax(.1, json_number(j, "aspect", .55)),
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
        if (media[0] == '/') snprintf(file, sizeof file, "%s.frames", media);
        else snprintf(file, sizeof file, "%s/%s.frames", dir, media);
        map_frames(s, file);
    }
    json_free(j); free(copy);
    return &s->preset;
}

// ponytail: the previous spec is kept (not freed) after a reload; a few KB per edit.
void spec_use(const struct preset *preset) { current = (struct spec *)preset; }
