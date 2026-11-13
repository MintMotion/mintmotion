# MintMotion — instalación
#   make                     compila las traducciones (build/locale)
#   sudo make install        instala en /usr (o PREFIX=...)
#   sudo make uninstall
#   make deb                 genera el paquete .deb en dist/
#   make pot                 regenera po/mintmotion.pot tras cambiar textos
#   make update-po           añade a los .po los textos nuevos de la plantilla
# Necesita gettext (msgfmt) para compilar las traducciones.

VERSION  := 1.6.0
UUID     := mintmotion@sombra
PREFIX   ?= /usr
SYSCONFDIR ?= /etc
DESTDIR  ?=

BIN      := $(DESTDIR)$(PREFIX)/bin
LIBDIR   := $(DESTDIR)$(PREFIX)/lib/mintmotion
EXTDIR   := $(DESTDIR)$(PREFIX)/share/cinnamon/extensions/$(UUID)
APPDIR   := $(DESTDIR)$(PREFIX)/share/applications
ICONDIR  := $(DESTDIR)$(PREFIX)/share/icons/hicolor/scalable/apps
DOCDIR   := $(DESTDIR)$(PREFIX)/share/doc/mintmotion
AUTODIR  := $(DESTDIR)$(SYSCONFDIR)/xdg/autostart
LOCDIR   := $(DESTDIR)$(PREFIX)/share/locale
LANGS    := $(basename $(notdir $(wildcard po/*.po)))
MOFILES  := $(foreach l,$(LANGS),build/locale/$(l)/LC_MESSAGES/mintmotion.mo)

.PHONY: all mo pot update-po install uninstall deb clean

all: mo

mo: $(MOFILES)

build/locale/%/LC_MESSAGES/mintmotion.mo: po/%.po
	@mkdir -p $(dir $@)
	msgfmt -c -o $@ $<

pot:
	xgettext --language=Python --from-code=UTF-8 --keyword=_ --keyword=N_ \
		--keyword=ngettext:1,2 --add-comments=TRANSLATORS --package-name=mintmotion \
		--package-version=$(VERSION) --msgid-bugs-address=hola@joseantonioramos.es \
		--copyright-holder="José Antonio Ramos Miralles" -o po/mintmotion.pot src/mintmotion

update-po: pot
	for l in $(LANGS); do msgmerge -q --update --backup=none po/$$l.po po/mintmotion.pot; done

install: mo
	install -Dm755 src/mintmotion $(BIN)/mintmotion
	install -Dm755 src/mintmotion-renderer $(LIBDIR)/mintmotion-renderer
	install -Dm755 src/mintmotion-xfce $(LIBDIR)/mintmotion-xfce
	install -Dm644 extension/$(UUID)/extension.js $(EXTDIR)/extension.js
	install -Dm644 extension/$(UUID)/metadata.json $(EXTDIR)/metadata.json
	install -Dm644 data/mintmotion.desktop $(APPDIR)/mintmotion.desktop
	install -Dm644 data/mintmotion.svg $(ICONDIR)/mintmotion.svg
	mkdir -p $(AUTODIR)
	sed 's#@LIBDIR@#$(PREFIX)/lib/mintmotion#g' data/mintmotion-xfce.desktop.in > $(AUTODIR)/mintmotion-xfce.desktop
	chmod 644 $(AUTODIR)/mintmotion-xfce.desktop
	install -Dm644 README.md $(DOCDIR)/README.md
	install -Dm644 README.es.md $(DOCDIR)/README.es.md
	install -Dm644 docs/DEVELOPERS.md $(DOCDIR)/DEVELOPERS.md
	for l in $(LANGS); do install -Dm644 build/locale/$$l/LC_MESSAGES/mintmotion.mo \
		$(LOCDIR)/$$l/LC_MESSAGES/mintmotion.mo; done
	-[ -z "$(DESTDIR)" ] && gtk-update-icon-cache -q -t -f $(DESTDIR)$(PREFIX)/share/icons/hicolor || true

uninstall:
	-pkill -TERM -f '$(PREFIX)/lib/mintmotion/mintmotion-xfce' 2>/dev/null; true
	rm -f  $(BIN)/mintmotion $(APPDIR)/mintmotion.desktop $(ICONDIR)/mintmotion.svg
	rm -f  $(AUTODIR)/mintmotion-xfce.desktop
	rm -rf $(LIBDIR) $(EXTDIR) $(DOCDIR)
	rm -f $(foreach l,$(LANGS),$(LOCDIR)/$(l)/LC_MESSAGES/mintmotion.mo)

deb:
	./packaging/build-deb.sh $(VERSION)

clean:
	rm -rf dist build
