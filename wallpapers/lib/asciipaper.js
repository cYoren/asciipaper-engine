// Portable defaults for ordinary browsers and wallpaper hosts.
// asciipaper and Lively provide this API themselves with the user's saved values.
(() => {
  if (window.asciipaper?.options && window.asciipaper?.onChange) return;

  const options = {fps: 24, quality: 0.85, pointer: 1};
  const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  const baseDpr = descriptor?.get ? descriptor.get.call(window) : descriptor?.value || 1;
  let last = 0;

  function apply(next) {
    Object.assign(options, next || {});
    options.fps = Math.max(5, Math.min(60, Number(options.fps) || 24));
    options.quality = Math.max(0.5, Math.min(1.5, Number(options.quality) || 0.85));
    options.pointer = Math.max(0, Math.min(2, Number(options.pointer) || 0));
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: () => baseDpr * options.quality
      });
    } catch (_) {}
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('asciipaper-settings', {detail: {...options}}));
  }

  const originalRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => originalRaf(now => {
    if (now - last >= 1000 / options.fps - 1) {
      last = now;
      callback(now);
    } else {
      window.requestAnimationFrame(callback);
    }
  });

  window.asciipaper = {
    options,
    set: apply,
    onChange(callback) {
      window.addEventListener('asciipaper-settings', event => callback(event.detail));
    }
  };
  apply(options);
})();
