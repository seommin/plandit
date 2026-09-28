/** Unit tests: src/**\/*.spec.ts. e2e tests use test/jest-e2e.config.js. */
const swc = [
  "@swc/jest",
  {
    jsc: {
      parser: { syntax: "typescript", decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: "es2022",
    },
    module: { type: "commonjs" },
  },
];

module.exports = {
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testEnvironment: "node",
  transform: { "^.+\\.ts$": swc },
};
