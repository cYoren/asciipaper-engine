// Interface between the native host (engine.c) and the built-in presets (presets.c). Mirrors the
// ascii() config and scene object of wallpapers/lib/asciipaper.js.
#include <stdint.h>

struct pointer {
    float x, y, vx, vy;   // 0..1 from the top left; velocity in screens per second
    int down, inside;
    double moved;         // seconds (monotonic) of the last move
};

struct scene {
    int width, height;    // logical pixels
    int cols, rows;       // character grid
    double time;          // u_time
    float strength;       // the user's pointer response setting, 0..2
    struct pointer *pointer;
    uint8_t *data;        // cols x rows RGBA, for presets without GLSL (see scene_put)
    void *state;          // the preset's own, per monitor
    struct output *output;
};

struct preset {
    const char *name, *charset, *font, *background, *glsl;   // glsl NULL: CPU scene via scene_put
    float cell, aspect, max_cells, time, period;
    float fill;                                             // 0..1: each glyph's colour, faintly, behind it
    int weight;                                             // font weight, 100..900 (0 = regular)
    const uint8_t *lut;                                     // 256 glyph indices, or NULL
    float shape, dither;                                    // indices into SHAPES / DITHERS (spec.c)
    int npalette;                                           // 0 = the shader's own colours
    float palette[16 * 3];
    float fx[12];                                           // post effects, in FX order (spec.c)
    void (*resize)(struct scene *);
    void (*update)(struct scene *, float dt);
    void (*pointer_move)(struct scene *);
    void (*pointer_down)(struct scene *);
    void (*pointer_leave)(struct scene *);
};

extern const struct preset *const presets[];
void preset_destroy(const struct preset *, struct scene *);

// For update(): set a uniform the preset's GLSL declares, or upload an RGB (channels 3) or RGBA
// (channels 4) texture it reads as `uniform sampler2D <name>` (row 0 = top).
void scene_uniform(struct scene *, const char *name, int n, const float *v);
void scene_texture(struct scene *, const char *name, int w, int h, int channels, const uint8_t *pixels);

static inline void scene_put(struct scene *s, int col, int row, float level, float r, float g, float b) {
    uint8_t *d = s->data + (row * s->cols + col) * 4;
    d[0] = r * 255; d[1] = g * 255; d[2] = b * 255; d[3] = level * 255;
}
