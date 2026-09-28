// The built-in presets for the native engine. Each is wallpapers/<name>.html: the GLSL is copied
// verbatim and the page's JavaScript is ported line for line, so both renderers look the same.
// ponytail: shaders are duplicated from the HTML; keep them in sync when editing a preset.
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "engine.h"

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---- matrix.html
static const struct preset matrix = {
    .name = "matrix", .charset = " ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEF",
    .cell = 16, .aspect = 1, .background = "#000000", .font = "monospace",
    // ${CHARS.length - 1} is 41.0
    .glsl =
"float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n"
"vec4 cell(vec2 uv){\n"
"  vec2 c=floor(uv*u_grid);\n"
"  float speed=5.0+hash(vec2(c.x,1.0))*9.0, len=6.0+hash(vec2(c.x,2.0))*22.0;\n"
"  float span=u_grid.y+len+hash(vec2(c.x,3.0))*50.0;\n"
"  float d=mod(u_time*speed+hash(vec2(c.x,4.0))*span,span)-c.y;\n"
"  float b=d>=0.0&&d<len?1.0-d/len:0.0;\n"
"  float near=u_strength*smoothstep(0.2,0.0,length((uv-u_pointer)*vec2(u_aspect,1.0)))*step(u_idle,2.0);\n"
"  float ring=0.0;\n"
"  for(int i=0;i<8;i++){vec3 k=u_clicks[i];\n"
"    ring=max(ring,smoothstep(0.025,0.0,abs(length((uv-k.xy)*vec2(u_aspect,1.0))-k.z*0.5))*max(0.0,1.0-k.z/1.6));}\n"
"  b=max(max(b,near*0.35),ring);\n"
"  if(b<0.03)return vec4(0.0);\n"
"  float flip=floor(u_time*(1.5+near*25.0)+hash(c)*9.0);\n"
"  float glyph=1.0+floor(hash(c+flip*vec2(1.7,9.2))*41.0);\n"
"  vec3 color=d>=0.0&&d<1.0?vec3(0.8,1.0,0.8):vec3(0.0,1.0,0.27)*b;\n"
"  return vec4(color,glyph/41.0);\n"
"}\n",
};

// ---- yin-yang.html
struct yin_yang { float px, py, angle; };

static void yin_yang_update(struct scene *s, float dt) {
    struct yin_yang *y = s->state ? s->state : (s->state = calloc(1, sizeof *y));
    if (!y->px && !y->py) y->px = y->py = .5f;
    const struct pointer *p = s->pointer;
    float k = s->strength;
    y->px += ((p->inside ? p->x : .5f) - y->px) * .08f; y->py += ((p->inside ? p->y : .5f) - y->py) * .08f;
    y->angle += dt * (.24f + fminf(hypotf(y->px - .5f, y->py - .5f) * k, .5f) * .9f);
    float radius = fmaxf(30, fminf(s->width * .31f, s->height * .40f));
    float center[2] = {s->width * (.5f + (y->px - .5f) * .12f * k), s->height * (.5f + (y->py - .5f) * .12f * k)};
    float rot = y->angle + atan2f(y->py - .5f, y->px - .5f) * .10f * k;
    scene_uniform(s, "radius", 1, &radius); scene_uniform(s, "center", 2, center); scene_uniform(s, "rot", 1, &rot);
}

static const struct preset yin_yang = {
    .name = "yin-yang", .charset = " .,:;irsXA253hMHGS#9B&@·", .cell = 9, .aspect = 9.f / 15, .background = "#080909",
    .update = yin_yang_update,
    .glsl =
"uniform vec2 center;uniform float radius,rot;\n"
"vec4 cell(vec2 uv){\n"
"  vec2 s=uv*u_size-center;\n"
"  float ca=cos(rot),sa=sin(rot);\n"
"  vec2 q=vec2(s.x*ca+s.y*sa,-s.x*sa+s.y*ca)/radius;\n"
"  float r=length(q);\n"
"  float ring=0.0;\n"
"  for(int i=0;i<8;i++){vec3 k=u_clicks[i];\n"
"    if(k.z<1.3)ring=max(ring,(1.0-k.z/1.3)*step(abs(length((uv-k.xy)*u_size)-k.z*0.7*radius),5.0));}\n"
"  if(ring>0.0)return vec4(vec3(143.0,230.0,218.0)/255.0*ring*0.7+0.1,1.0);\n"
"  if(r>1.035)return vec4(0.0);\n"
"  bool white=q.x-0.42*sin(3.14159265*q.y)<0.0;\n"
"  if(length(q-vec2(0.0,0.5))<0.14)white=false;\n"
"  if(length(q+vec2(0.0,0.5))<0.14)white=true;\n"
"  float grain=(sin(q.x*32.0+q.y*17.0)+cos(q.y*29.0-q.x*13.0))*0.5;\n"
"  float shade=clamp(floor((r>0.92?0.55:0.58+grain*0.12)*22.0),0.0,22.0);\n"
"  float glow=max(0.0,1.0-length(s/u_size)*2.3);\n"
"  vec3 color=white?(vec3(196.0,208.0,206.0)+glow*vec3(59.0,47.0,49.0))/255.0\n"
"                  :(vec3(30.0,91.0,91.0)+glow*vec3(24.0,55.0,55.0))/255.0;\n"
"  return vec4(color,shade/23.0);\n"
"}\n",
};

// ---- flow.html: stable fluids on the CPU (inject → advect → project), drawn with scene_put.
#define FLOW_ITER 4
#define RAMP_LEN 10
struct flow { int cols, rows; float *vx, *vy, *vx0, *vy0, *d, *d0, *p, *div, t, mx, my, pmx, pmy; float colors[RAMP_LEN][3]; };

static float flow_sample(const struct flow *f, const float *a, float fx, float fy) {
    fx = clampf(fx, 0, f->cols - 1.001f); fy = clampf(fy, 0, f->rows - 1.001f);
    int i = (int)fx, j = (int)fy, k = i + j * f->cols;
    float s = fx - i, t = fy - j;
    return (a[k] * (1 - s) + a[k + 1] * s) * (1 - t) + (a[k + f->cols] * (1 - s) + a[k + f->cols + 1] * s) * t;
}
static void flow_advect(struct flow *f, float *dst, const float *src, float decay) {
    for (int j = 0; j < f->rows; j++) for (int i = 0; i < f->cols; i++) {
        int k = i + j * f->cols;
        dst[k] = flow_sample(f, src, i - f->vx0[k], j - f->vy0[k]) * decay;
    }
}
static void flow_project(struct flow *f) {
    int c = f->cols;
    for (int j = 1; j < f->rows - 1; j++) for (int i = 1; i < c - 1; i++) {
        int k = i + j * c;
        f->div[k] = -0.5f * (f->vx[k + 1] - f->vx[k - 1] + f->vy[k + c] - f->vy[k - c]); f->p[k] = 0;
    }
    for (int n = 0; n < FLOW_ITER; n++)
        for (int j = 1; j < f->rows - 1; j++) for (int i = 1; i < c - 1; i++) {
            int k = i + j * c;
            f->p[k] = (f->div[k] + f->p[k - 1] + f->p[k + 1] + f->p[k - c] + f->p[k + c]) / 4;
        }
    for (int j = 1; j < f->rows - 1; j++) for (int i = 1; i < c - 1; i++) {
        int k = i + j * c;
        f->vx[k] -= 0.5f * (f->p[k + 1] - f->p[k - 1]); f->vy[k] -= 0.5f * (f->p[k + c] - f->p[k - c]);
    }
}
static void flow_splat(struct flow *f, float cx, float cy, float fx, float fy, float dens, float r) {
    for (int j = fmaxf(1, (int)(cy - r)); j < fminf(f->rows - 1, cy + r); j++)
        for (int i = fmaxf(1, (int)(cx - r)); i < fminf(f->cols - 1, cx + r); i++) {
            float w = fmaxf(0, 1 - hypotf(i - cx, j - cy) / r);
            int k = i + j * f->cols;
            f->vx[k] += fx * w; f->vy[k] += fy * w; f->d[k] = fminf(1.5f, f->d[k] + dens * w);
        }
}

static void flow_resize(struct scene *s) {
    struct flow *f = s->state;
    if (f) free(f->vx);
    else {
        f = s->state = calloc(1, sizeof *f);
        f->mx = f->my = f->pmx = f->pmy = -1;
        for (int i = 0; i < RAMP_LEN; i++) {   // hsl(165 70% 25..80%) → rgb 0..1
            float l = .25f + .55f * i / RAMP_LEN, a = .7f * fminf(l, 1 - l);
            for (int c = 0, n[3] = {0, 8, 4}; c < 3; c++) {
                float k = fmodf(n[c] + 165 / 30.f, 12);
                f->colors[i][c] = l - a * fmaxf(-1, fminf(fminf(k - 3, 9 - k), 1));
            }
        }
    }
    f->cols = s->cols; f->rows = s->rows;
    size_t n = (size_t)s->cols * s->rows;
    f->vx = calloc(n * 8, sizeof(float));   // one block for all eight fields
    f->vy = f->vx + n; f->vx0 = f->vy + n; f->vy0 = f->vx0 + n; f->d = f->vy0 + n; f->d0 = f->d + n; f->p = f->d0 + n; f->div = f->p + n;
}

static void flow_update(struct scene *s, float dt) {
    struct flow *f = s->state;
    int n = f->cols * f->rows;
    f->t += 0.016f;
    float k = s->strength;
    if (f->mx >= 0 && f->pmx >= 0) flow_splat(f, f->mx, f->my, (f->mx - f->pmx) * 0.6f * k, (f->my - f->pmy) * 0.6f * k, 0.35f * k, 4);
    f->pmx = f->mx; f->pmy = f->my;
    for (int i = 0; i < 3; i++) {   // ambient drift so it lives without a cursor
        float a = f->t * 0.25f + i * 2.1f, cx = f->cols * (0.5f + 0.35f * cosf(a + i)), cy = f->rows * (0.5f + 0.35f * sinf(a * 0.7f));
        flow_splat(f, cx, cy, -sinf(a) * 0.15f, cosf(a) * 0.15f, 0.03f, 6);
    }
    memcpy(f->vx0, f->vx, n * sizeof(float)); memcpy(f->vy0, f->vy, n * sizeof(float));
    flow_advect(f, f->vx, f->vx0, 0.995f); flow_advect(f, f->vy, f->vy0, 0.995f);
    flow_project(f);
    memcpy(f->vx0, f->vx, n * sizeof(float)); memcpy(f->vy0, f->vy, n * sizeof(float)); memcpy(f->d0, f->d, n * sizeof(float));
    flow_advect(f, f->d, f->d0, 0.985f);
    for (int i = 0; i < n; i++) {
        float v = f->d[i];
        int l = v < 0.03f ? 0 : fminf(RAMP_LEN - 1, (int)(v * RAMP_LEN));
        scene_put(s, i % f->cols, i / f->cols, (float)l / (RAMP_LEN - 1), f->colors[l][0], f->colors[l][1], f->colors[l][2]);
    }
}
static void flow_move(struct scene *s) {
    struct flow *f = s->state;
    f->mx = s->pointer->x * f->cols; f->my = s->pointer->y * f->rows;
}
static void flow_down(struct scene *s) {
    struct flow *f = s->state;
    flow_splat(f, s->pointer->x * f->cols, s->pointer->y * f->rows, 0, 0, 1.5f, 8);
}

static const struct preset flow = {
    .name = "flow", .charset = " .:-=+*#%@", .cell = 10, .aspect = 10.f / 16, .background = "#080909",
    .resize = flow_resize, .update = flow_update, .pointer_move = flow_move, .pointer_down = flow_down,
};

// ---- fluid.html: asciify's Fluid. FluidField is ported from the page (itself from asciify-engine,
// MIT, © ayangabryl), with continuousWake off as the page uses it.
#define MAX_STROKES 12
struct stroke { float x, y, dx, dy, speed; };
struct fluid {
    float aspect, energy; int columns, rows, has_previous, strokes;
    float px, py, *front, *back;
    struct stroke stroke[MAX_STROKES];
    uint8_t *bytes;
};

static void fluid_read(const struct fluid *f, const float *data, float x, float y, float *out) {
    float gx = clampf(x * (f->columns - 1), 0, f->columns - 1.001f), gy = clampf(y * (f->rows - 1), 0, f->rows - 1.001f);
    int ix = floorf(gx), iy = floorf(gy);
    float fx = gx - ix, fy = gy - iy, lw = 1 - fx, tw = 1 - fy;
    int top = (iy * f->columns + ix) * 3, bottom = top + f->columns * 3;
    for (int c = 0; c < 3; c++)
        out[c] = (data[top + c] * lw + data[top + 3 + c] * fx) * tw + (data[bottom + c] * lw + data[bottom + 3 + c] * fx) * fy;
}
static int fluid_active(const struct fluid *f) { return f->energy > .0005f || f->strokes > 0; }
static void fluid_clear(struct fluid *f) {
    memset(f->front, 0, sizeof(float) * f->columns * f->rows * 3); memset(f->back, 0, sizeof(float) * f->columns * f->rows * 3);
    f->strokes = 0; f->has_previous = 0; f->energy = 0;
}
static void fluid_step(struct fluid *f, float seconds) {
    if (!fluid_active(f)) return;
    float dt = clampf(seconds, 0, .05f), decay = expf(-dt * 3.5f), ink_decay = expf(-dt * 4.0f);
    float x_scale = fmaxf(1, f->aspect), y_scale = fmaxf(1, 1 / f->aspect), peak = 0, adv[3];
    for (int y = 0; y < f->rows; y++) for (int x = 0; x < f->columns; x++) {
        int i = (y * f->columns + x) * 3;
        float u = (float)x / (f->columns - 1), v = (float)y / (f->rows - 1);
        fluid_read(f, f->front, u - f->front[i] * dt * 2, v - f->front[i + 1] * dt * 2, adv);
        float dx = adv[0] * decay, dy = adv[1] * decay, ink = adv[2] * ink_decay;
        for (int k = 0; k < f->strokes; k++) {
            const struct stroke *st = &f->stroke[k];
            float rx = (u - st->x) * x_scale, ry = (v - st->y) * y_scale, distance = rx * rx + ry * ry;
            if (distance > .045f) continue;
            float weight = expf(-distance / .0075f);
            dx += (st->dx * 2.8f - ry * st->speed * .16f) * weight; dy += (st->dy * 2.8f + rx * st->speed * .16f) * weight;
            ink += st->speed * weight * .3f;
        }
        f->back[i] = clampf(dx, -.18f, .18f); f->back[i + 1] = clampf(dy, -.18f, .18f); f->back[i + 2] = fminf(.8f, ink);
        peak = fmaxf(peak, fmaxf(fmaxf(fabsf(dx), fabsf(dy)), ink));
    }
    float *t = f->front; f->front = f->back; f->back = t;
    f->strokes = 0; f->energy = peak;
    if (!fluid_active(f)) fluid_clear(f);
}
static void fluid_upload(struct scene *s, struct fluid *f) {
    for (int i = 0, o = 0, n = f->columns * f->rows * 3; i < n; i += 3, o += 4) {
        f->bytes[o] = 127.5f + f->front[i] / .36f * 255; f->bytes[o + 1] = 127.5f + f->front[i + 1] / .36f * 255;
        f->bytes[o + 2] = f->front[i + 2] / .8f * 255;
    }
    scene_texture(s, "flow", f->columns, f->rows, f->bytes);
}

static void fluid_resize(struct scene *s) {
    struct fluid *f = s->state;
    if (f) { free(f->front); free(f->bytes); } else f = s->state = calloc(1, sizeof *f);
    f->aspect = clampf((float)s->width / s->height, .25f, 4);
    f->columns = f->aspect >= 1 ? 64 : roundf(64 * f->aspect);
    f->rows = f->aspect >= 1 ? roundf(64 / f->aspect) : 64;
    f->front = calloc((size_t)f->columns * f->rows * 3 * 2, sizeof(float)); f->back = f->front + f->columns * f->rows * 3;
    f->bytes = calloc((size_t)f->columns * f->rows * 4, 1);
    fluid_clear(f);
    fluid_upload(s, f);
}
static void fluid_update(struct scene *s, float dt) {
    struct fluid *f = s->state;
    fluid_step(f, fminf(.05f, dt));
    float moving = fluid_active(f);
    if (moving) fluid_upload(s, f);
    scene_uniform(s, "moving", 1, &moving);
}
static void fluid_move(struct scene *s) {
    struct fluid *f = s->state;
    float x = s->pointer->x, y = s->pointer->y;
    float px = f->has_previous ? f->px : x - .004f, py = f->has_previous ? f->py : y - .001f;
    float dx = clampf((x - px) * s->strength, -.09f, .09f), dy = clampf((y - py) * s->strength, -.09f, .09f);
    f->px = x; f->py = y; f->has_previous = 1;
    if (fabsf(dx) + fabsf(dy) < .0001f) return;
    if (f->strokes == MAX_STROKES) memmove(f->stroke, f->stroke + 1, sizeof f->stroke[0] * --f->strokes);
    f->stroke[f->strokes++] = (struct stroke){x, y, dx, dy, fminf(1, hypotf(dx * f->aspect, dy) * 25 + .06f)};
}
static void fluid_leave(struct scene *s) { ((struct fluid *)s->state)->has_previous = 0; }

// Luminance → glyph, computed once from the unmodified asciify-core.js (see fluid.html).
static const uint8_t fluid_lut[256] = {
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,
    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,
    10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,
    12,12,12,12,12,12,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,
    14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,
};

static const struct preset fluid = {
    .name = "fluid", .charset = " .:+-=xICA$FY#@", .cell = 7, .aspect = .58f, .max_cells = 26e3f,
    .background = "#000000", .font = "JetBrains Mono, monospace", .time = 12, .period = 200 * M_PI, .lut = fluid_lut,
    .resize = fluid_resize, .update = fluid_update, .pointer_move = fluid_move, .pointer_leave = fluid_leave,
    .glsl =
"uniform sampler2D flow;uniform float moving;\n"
"vec4 cell(vec2 uv){\n"
"  vec3 f=moving>0.5?(texture2D(flow,uv).rgb-vec3(0.5,0.5,0.0))*vec3(0.36,0.36,0.8):vec3(0.0);\n"
"  float time=u_time;\n"
"  float px=(uv.x-0.5-f.x)*u_aspect, py=uv.y-0.5-f.y;\n"
"  float qx=px+0.22*sin(py*5.2+time*0.17)+0.15*sin(px*2.4-py*3.1-time*0.1);\n"
"  float qy=py+0.19*sin(px*3.5+time*0.13);\n"
"  float radius=length(vec2(qx*0.8+0.18,qy*1.1));\n"
"  float folds=0.5+0.5*sin(radius*14.0-qx*2.8+sin(qy*5.0)*1.4-time*0.24);\n"
"  float cloud=0.5+0.5*sin(qx*3.6-qy*2.9+time*0.09);\n"
"  float light=clamp(folds*folds*(0.48+cloud*0.32)-0.075+f.z*0.75,0.0,1.0);\n"
"  float value=floor(light*255.0+0.5);\n"
"  float r=value<10.0?0.0:min(255.0,value*1.45), g=r*185.0/232.0;\n"
"  return vec4(r/255.0,g/255.0,0.0,floor(0.299*r+0.587*g)/255.0);\n"
"}\n",
};

const struct preset *const presets[] = {&fluid, &flow, &matrix, &yin_yang, NULL};
