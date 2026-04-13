const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const runCommand = async (command, args = [], options = {}) => {
  const result = await execFileAsync(command, args, {
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    encoding: options.encoding || "utf8",
  });
  return result;
};

const runCommandSafe = async (command, args = [], options = {}) => {
  try {
    return await runCommand(command, args, options);
  } catch (error) {
    return {
      stdout: options.encoding === "buffer" ? Buffer.from("") : "",
      stderr: error?.stderr || "",
      code: error?.code || 1,
      error,
    };
  }
};

module.exports = {
  runCommand,
  runCommandSafe,
};
