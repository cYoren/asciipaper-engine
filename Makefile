# Build the native engine, then check the generated resources (native/shaders.h,
# wallpapers/lib/legacy.js, catalogs) are up to date with wallpapers/lib.
all:
	$(MAKE) -C native

test:
	python3 -m unittest discover -s tests -v

clean:
	$(MAKE) -C native clean

.PHONY: all test clean
