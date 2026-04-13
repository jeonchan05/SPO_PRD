const mapWithConcurrency = async (items, worker, options = {}) => {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const concurrency = Math.max(1, Number(options.concurrency || 1));
  const result = new Array(list.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= list.length) break;
      result[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return result;
};

module.exports = {
  mapWithConcurrency,
};
