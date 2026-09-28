// Just enough JSON for wallpaper specs: the whole grammar, no streaming, UTF-8 strings.
#include <stdlib.h>
#include <string.h>
#include "json.h"

static const char *at;

static void space(void) { while (*at == ' ' || *at == '\t' || *at == '\n' || *at == '\r') at++; }

static int utf8(char *out, unsigned c) {
    if (c < 0x80) { out[0] = c; return 1; }
    if (c < 0x800) { out[0] = 0xc0 | c >> 6; out[1] = 0x80 | (c & 63); return 2; }
    if (c < 0x10000) { out[0] = 0xe0 | c >> 12; out[1] = 0x80 | (c >> 6 & 63); out[2] = 0x80 | (c & 63); return 3; }
    out[0] = 0xf0 | c >> 18; out[1] = 0x80 | (c >> 12 & 63); out[2] = 0x80 | (c >> 6 & 63); out[3] = 0x80 | (c & 63);
    return 4;
}

static unsigned hex4(void) {
    unsigned v = 0;
    for (int i = 0; i < 4; i++, at++) {
        char c = *at;
        v = v * 16 + (c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : 0);
        if (!c) return v;
    }
    return v;
}

static char *string(void) {
    const char *start = ++at;
    size_t n = 0;
    while (*at && *at != '"') at += *at == '\\' && at[1] ? 2 : 1, n++;
    char *out = malloc(n * 4 + 1), *o = out;
    for (at = start; *at && *at != '"';) {
        if (*at != '\\') { *o++ = *at++; continue; }
        at++;
        char c = *at++;
        if (c == 'n') *o++ = '\n'; else if (c == 't') *o++ = '\t'; else if (c == 'r') *o++ = '\r';
        else if (c == 'b') *o++ = '\b'; else if (c == 'f') *o++ = '\f';
        else if (c == 'u') {
            unsigned u = hex4();
            if (u >= 0xd800 && u < 0xdc00 && at[0] == '\\' && at[1] == 'u') { at += 2; u = 0x10000 + ((u - 0xd800) << 10) + (hex4() - 0xdc00); }
            o += utf8(o, u);
        } else if (c) *o++ = c;
    }
    *o = 0;
    if (*at == '"') at++;
    return out;
}

static struct json *value(int depth);

static struct json *list(char close, int object, int depth) {
    struct json *j = calloc(1, sizeof *j);
    j->type = object ? JSON_OBJECT : JSON_ARRAY;
    at++;
    for (space(); *at && *at != close; space()) {
        char *key = NULL;
        if (object) {
            if (*at != '"') break;
            key = string(); space();
            if (*at == ':') at++;
        }
        struct json *v = value(depth + 1);
        if (!v) { free(key); break; }
        j->items = realloc(j->items, sizeof *j->items * (j->count + 1));
        j->keys = realloc(j->keys, sizeof *j->keys * (j->count + 1));
        j->items[j->count] = v; j->keys[j->count++] = key;
        space();
        if (*at == ',') at++;
    }
    if (*at == close) at++;
    return j;
}

static struct json *value(int depth) {
    space();
    if (depth > 64) return NULL;
    struct json *j;
    if (*at == '{') return list('}', 1, depth);
    if (*at == '[') return list(']', 0, depth);
    j = calloc(1, sizeof *j);
    if (*at == '"') { j->type = JSON_STRING; j->string = string(); }
    else if (!strncmp(at, "true", 4)) { j->type = JSON_BOOL; j->number = 1; at += 4; }
    else if (!strncmp(at, "false", 5)) { j->type = JSON_BOOL; at += 5; }
    else if (!strncmp(at, "null", 4)) { j->type = JSON_NULL; at += 4; }
    else {
        char *end;
        j->type = JSON_NUMBER; j->number = strtod(at, &end);
        if (end == at) { free(j); return NULL; }
        at = end;
    }
    return j;
}

struct json *json_parse(const char *text) {
    at = text;
    struct json *j = value(0);
    space();
    if (j && *at) { json_free(j); return NULL; }   // trailing garbage: not valid JSON
    return j;
}

void json_free(struct json *j) {
    if (!j) return;
    for (int i = 0; i < j->count; i++) { json_free(j->items[i]); free(j->keys[i]); }
    free(j->items); free(j->keys); free(j->string); free(j);
}

struct json *json_get(const struct json *j, const char *key) {
    for (int i = 0; j && j->type == JSON_OBJECT && i < j->count; i++)
        if (!strcmp(j->keys[i], key)) return j->items[i];
    return NULL;
}

double json_number(const struct json *j, const char *key, double fallback) {
    const struct json *v = json_get(j, key);
    return v && (v->type == JSON_NUMBER || v->type == JSON_BOOL) ? v->number : fallback;
}

const char *json_string(const struct json *j, const char *key, const char *fallback) {
    const struct json *v = json_get(j, key);
    return v && v->type == JSON_STRING ? v->string : fallback;
}
