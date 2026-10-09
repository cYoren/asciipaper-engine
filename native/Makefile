# asciipaper-engine: the built-in presets on EGL + OpenGL ES 2, without WebKit.
# Build deps: a C compiler, pkg-config, wayland-scanner, wayland-protocols, and the development
# files for wayland, EGL, GLESv2 and pango (see install.sh for package names).
PKGS = wayland-client wayland-egl egl glesv2 pangocairo
CFLAGS ?= -O2 -Wall
PROTOCOLS = $(shell pkg-config --variable=pkgdatadir wayland-protocols)
# layer-shell is vendored (wlr-protocols isn't packaged everywhere); the rest come from wayland-protocols.
# xdg-shell and tablet are only referenced by layer-shell and cursor-shape; they need their interface code.
XML = wlr-layer-shell-unstable-v1.xml $(PROTOCOLS)/staging/fractional-scale/fractional-scale-v1.xml \
      $(PROTOCOLS)/stable/viewporter/viewporter.xml $(PROTOCOLS)/staging/cursor-shape/cursor-shape-v1.xml \
      $(PROTOCOLS)/stable/xdg-shell/xdg-shell.xml $(PROTOCOLS)/stable/tablet/tablet-v2.xml
HEADERS = $(patsubst %.xml,%-client-protocol.h,$(notdir $(XML)))
CODE = $(patsubst %.xml,%-protocol.c,$(notdir $(XML)))
vpath %.xml $(sort $(dir $(XML)))

asciipaper-engine: engine.c presets.c spec.c json.c engine.h spec.h json.h shaders.h look_names.h $(HEADERS) $(CODE) | check-runtime
	$(CC) $(CPPFLAGS) $(CFLAGS) $(shell pkg-config --cflags $(PKGS)) -I. -o $@ engine.c presets.c spec.c json.c $(CODE) $(LDFLAGS) $(shell pkg-config --libs $(PKGS)) -lm

.PHONY: check-runtime
check-runtime:
	python3 ../tools/generate_runtime.py --check

%-client-protocol.h: %.xml
	wayland-scanner client-header $< $@
%-protocol.c: %.xml
	wayland-scanner private-code $< $@

clean:
	rm -f asciipaper-engine *-client-protocol.h *-protocol.c
