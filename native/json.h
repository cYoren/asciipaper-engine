enum { JSON_NULL, JSON_BOOL, JSON_NUMBER, JSON_STRING, JSON_ARRAY, JSON_OBJECT };

struct json {
    int type, count;
    double number;           // also 0/1 for booleans
    char *string;
    struct json **items;     // array elements or object values
    char **keys;             // object keys, NULL in arrays
};

struct json *json_parse(const char *text);   // NULL if not valid JSON
void json_free(struct json *);
struct json *json_get(const struct json *object, const char *key);
double json_number(const struct json *object, const char *key, double fallback);
const char *json_string(const struct json *object, const char *key, const char *fallback);
