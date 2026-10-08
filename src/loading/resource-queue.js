/** Bounded downloads; duplicate URLs share bytes, never mutable model instances. */
export function createResourceQueue({ concurrency = 4, fetchResource = fetch } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  const entries = new Map(),
    waiting = [];
  let active = 0;
  function pump() {
    while (active < concurrency && waiting.length) {
      const entry = waiting.shift();
      active++;
      Promise.resolve()
        .then(() => fetchResource(entry.url))
        .then((response) => {
          if (!response.ok) throw new Error(`Asset download failed: HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then(entry.resolve, (error) => {
          if (entries.get(entry.url) === entry) entries.delete(entry.url);
          entry.reject(error);
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  }
  return {
    load(url) {
      if (entries.has(url)) return entries.get(url).promise;
      const entry = { url };
      entry.promise = new Promise((resolve, reject) => Object.assign(entry, { resolve, reject }));
      entries.set(url, entry);
      waiting.push(entry);
      pump();
      return entry.promise;
    },
    release(url, promise) {
      if (!promise || entries.get(url)?.promise === promise) entries.delete(url);
    },
    snapshot: () => ({ active, queued: waiting.length, retained: entries.size }),
  };
}
