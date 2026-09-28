module.exports = {
  ...require("../jest.config"),
  rootDir: ".",
  testRegex: ".*\\.e2e-spec\\.ts$",
  globalSetup: "<rootDir>/global-setup.js",
  setupFiles: ["<rootDir>/setup-env.js"],
};
