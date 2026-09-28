#include <stddef.h>

// Load a wallpaper spec (see spec.c). lib holds media.glsl. On success, shader_file receives the
// shader's path when it came from a file (for reloading on change). NULL if the spec is unusable.
const struct preset *spec_load(const char *path, const char *lib, char *shader_file, size_t shader_file_size);
// Make a loaded spec the one being drawn (after its shader compiled).
void spec_use(const struct preset *);
