// A stand-in for the Windows app's host, for working on the Studio in a browser:
// serve a folder with app/ (this repo's studio/ and wallpapers/) and library/, open app/studio/?mock.
window.mockHost = (() => {
  const preset = n => ({name: n, title: n, kind: 'preset', url: `/app/wallpapers/${n}.html`, thumb: null, own: false});
  const spec = n => ({name: n, title: n, kind: 'spec', url: `/app/wallpapers/run.html?spec=/library/${n}.json`,
                      spec: `/library/${n}.json`, thumb: null, own: true});
  const state = {current: 'fluid', paused: false, autostart: true, version: 'dev',
                 options: {fps: 24, idleFps: 12, quality: 1, pointer: 1, clicks: false},
                 library: [...['fluid', 'flow', 'matrix', 'yin-yang'].map(preset), ...['mandelbrot', 'sketch'].map(spec)]};
  const copy = () => JSON.parse(JSON.stringify(state));
  const methods = {
    state: () => copy(),
    apply: ({name}) => (state.current = name, copy()),
    pause: ({paused}) => (state.paused = paused, copy()),
    setOptions: ({options}) => (Object.assign(state.options, options), copy()),
    setAutostart: ({on}) => (state.autostart = on, copy()),
    saveSpec: () => true,
    saveThumb: ({name, data}) => (state.library.find(w => w.name === name).thumb = data),
  };
  return {call: async (m, p = {}) => { if (!methods[m]) throw new Error(`mock: ${m} isn't available`); return methods[m](p); },
          files: async () => { throw new Error('mock: no files'); }, on() {}};
})();
