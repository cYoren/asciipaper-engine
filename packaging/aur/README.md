# AUR package

`PKGBUILD`, `.SRCINFO` and `asciipaper.install` for [aur.archlinux.org/packages/asciipaper](https://aur.archlinux.org/packages/asciipaper).

Publish (once: create an AUR account and add your SSH public key under *My Account*):

```sh
git clone ssh://aur@aur.archlinux.org/asciipaper.git aur-asciipaper
cp PKGBUILD .SRCINFO asciipaper.install aur-asciipaper/
cd aur-asciipaper && git add -A && git commit -m "asciipaper 1.1.0" && git push
```

New release: tag `vX.Y.Z` and push it, set `pkgver` (and `pkgrel=1`), then
`updpkgsums && makepkg --printsrcinfo > .SRCINFO && makepkg -f` to check the build, and publish as above.
