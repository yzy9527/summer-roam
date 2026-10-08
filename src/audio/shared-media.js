const managedMedia = new WeakMap();

function aborted() {
  const error = new Error('Audio playback was cancelled');
  error.name = 'AbortError';
  return error;
}

/** Share successful downloads for the lifetime of a page, including in-flight requests. */
export function createAudioResourceCache({
  baseURL = document.baseURI,
  fetchResource = fetch,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
} = {}) {
  const entries = new Map();
  let disposed = false;
  const resolveURL = (url) => new URL(url, baseURL).href;
  return {
    resolveURL,
    peek: (url) => entries.get(resolveURL(url))?.objectURL,
    load(url) {
      if (disposed) return Promise.reject(aborted());
      const key = resolveURL(url);
      if (entries.has(key)) return entries.get(key).promise;
      const entry = { controller: new globalThis.AbortController(), objectURL: null };
      entries.set(key, entry);
      entry.promise = Promise.resolve()
        .then(() => {
          if (disposed) throw aborted();
          return fetchResource(key, { signal: entry.controller.signal });
        })
        .then((response) => {
          if (!response.ok) throw new Error(`Audio download failed: HTTP ${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          if (disposed) throw aborted();
          if (!blob.size) throw new Error('Audio download was empty');
          entry.objectURL = createObjectURL(blob);
          return entry.objectURL;
        })
        .catch((error) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      return entry.promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.controller.abort();
        if (entry.objectURL) revokeObjectURL(entry.objectURL);
      }
      entries.clear();
    },
  };
}

/**
 * Keep native media elements and native playback events. Only these instances'
 * play/pause methods coordinate download readiness and cancellation; no global
 * Audio constructor or prototype is changed.
 */
export function createSharedMediaPool({
  resources = createAudioResourceCache(),
  createMedia = () => new Audio(),
} = {}) {
  const players = new Set();
  let disposed = false;
  return {
    create(url, { preload = 'auto' } = {}) {
      if (disposed) throw aborted();
      const media = createMedia();
      const nativePlay = media.play.bind(media),
        nativePause = media.pause.bind(media),
        nativeLoad = media.load.bind(media);
      let source = resources.resolveURL(url),
        generation = 0,
        boundURL = null,
        loading = null;
      const pending = new Set();
      media.preload = preload;

      function cancel() {
        generation++;
        for (const reject of pending) reject(aborted());
        pending.clear();
      }
      function bind(objectURL) {
        if (boundURL !== objectURL) {
          media.src = objectURL;
          boundURL = objectURL;
        } else if (media.error) nativeLoad();
      }
      function prepare() {
        if (disposed) return Promise.reject(aborted());
        const ready = resources.peek(source);
        if (ready) {
          bind(ready);
          return Promise.resolve();
        }
        if (loading) return loading;
        const requestedSource = source;
        const request = resources.load(source).then((objectURL) => {
          if (disposed || source !== requestedSource || loading !== request) throw aborted();
          bind(objectURL);
        });
        loading = request;
        request.then(
          () => {
            if (loading === request) loading = null;
          },
          () => {
            if (loading === request) loading = null;
          },
        );
        return request;
      }
      media.play = () => {
        if (disposed) return Promise.reject(aborted());
        // Cached data can start synchronously within a user gesture, without
        // reassigning src or resetting a music track's retained playhead.
        if (resources.peek(source)) {
          bind(resources.peek(source));
          return nativePlay();
        }
        const ticket = generation;
        return new Promise((resolve, reject) => {
          pending.add(reject);
          const finish = (callback, value) => {
            pending.delete(reject);
            callback(value);
          };
          prepare().then(
            () => {
              if (disposed || ticket !== generation) {
                finish(reject, aborted());
                return;
              }
              try {
                Promise.resolve(nativePlay()).then(
                  (value) => finish(resolve, value),
                  (error) => finish(reject, error),
                );
              } catch (error) {
                finish(reject, error);
              }
            },
            (error) => finish(reject, error),
          );
        });
      };
      media.pause = () => {
        cancel();
        nativePause();
      };
      const state = {
        setSource(url) {
          if (disposed) throw aborted();
          const next = resources.resolveURL(url);
          if (next === source) return;
          media.pause();
          source = next;
          loading = null;
          boundURL = null;
          media.removeAttribute('src');
          nativeLoad();
          if (media.preload !== 'none') void prepare().catch(() => {});
        },
        dispose() {
          media.pause();
          media.muted = true;
          media.removeAttribute('src');
          nativeLoad();
        },
      };
      managedMedia.set(media, state);
      players.add(state);
      // Prefetch failures are retried only by a later request, never in a loop.
      if (preload !== 'none') void prepare().catch(() => {});
      return media;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const player of players) player.dispose();
      players.clear();
      resources.dispose();
    },
  };
}

// Explicit source changes also keep existing injected test/media fixtures usable.
export function setAudioSource(media, url) {
  const state = managedMedia.get(media);
  if (state) state.setSource(url);
  else if (media.src !== url) media.src = url;
}

let pagePool;
let listening = false;
export function createSharedAudio(url, options) {
  if (!pagePool) pagePool = createSharedMediaPool();
  if (!listening) {
    window.addEventListener('pagehide', (event) => {
      // A BFCache entry still owns its resources and must be able to resume.
      if (event.persisted) return;
      pagePool?.dispose();
      pagePool = null;
    });
    listening = true;
  }
  return pagePool.create(url, options);
}
