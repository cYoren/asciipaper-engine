# Build the native engine and install everything, e.g. for a distribution package:
#   make && make install PREFIX=/usr DESTDIR="$pkgdir"
# (install.sh does a per-user install into ~/.local instead.)
PREFIX ?= /usr/local
DATADIR = $(DESTDIR)$(PREFIX)/share

all:
	$(MAKE) -C native

install: all
	install -Dm755 asciipaper $(DESTDIR)$(PREFIX)/bin/asciipaper
	install -Dm755 native/asciipaper-engine $(DESTDIR)$(PREFIX)/bin/asciipaper-engine
	cd wallpapers && find . -type f -exec install -Dm644 {} "$(DATADIR)/asciipaper/wallpapers/{}" \;
	sed 's|%h/.local/bin/asciipaper|$(PREFIX)/bin/asciipaper|' asciipaper.service > asciipaper.service.out
	install -Dm644 asciipaper.service.out $(DESTDIR)$(PREFIX)/lib/systemd/user/asciipaper.service
	rm asciipaper.service.out
	install -Dm644 io.github.cyoren.asciipaper.desktop $(DATADIR)/applications/io.github.cyoren.asciipaper.desktop
	install -Dm644 io.github.cyoren.asciipaper.svg $(DATADIR)/icons/hicolor/scalable/apps/io.github.cyoren.asciipaper.svg
	install -Dm644 io.github.cyoren.asciipaper.metainfo.xml $(DATADIR)/metainfo/io.github.cyoren.asciipaper.metainfo.xml
	install -Dm644 skills/asciipaper/SKILL.md $(DATADIR)/doc/asciipaper/SKILL.md
	install -Dm644 README.md $(DATADIR)/doc/asciipaper/README.md

clean:
	$(MAKE) -C native clean

.PHONY: all install clean
