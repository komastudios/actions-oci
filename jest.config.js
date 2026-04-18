module.exports = {
  clearMocks: true,
  moduleFileExtensions: ["js", "ts"],
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { noImplicitAny: true } }],
  },
  verbose: true,
};

const processStdoutWrite = process.stdout.write.bind(process.stdout);
// Suppress GitHub Actions :: command protocol during tests so @actions/core
// calls don't pollute runner state or the jest report.
process.stdout.write = (str, encoding, cb) => {
  if (typeof str === "string" && !str.match(/^::/)) {
    return processStdoutWrite(str, encoding, cb);
  }
  if (typeof cb === "function") cb();
  return true;
};
