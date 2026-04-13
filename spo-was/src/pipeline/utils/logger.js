const createLogger = (verbose = false) => ({
  info: (...args) => {
    console.log(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
  debug: (...args) => {
    if (verbose) {
      console.log("[debug]", ...args);
    }
  },
});

module.exports = {
  createLogger,
};
