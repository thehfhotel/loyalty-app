/**
 * Custom Allure Jest environment that gracefully resolves the Node environment.
 * The allure-jest package expects jest-environment-node to be hoisted, which is
 * not guaranteed with npm v9+ hoisting rules. We resolve it manually from the
 * installed jest package to keep the Allure integration working.
 */
const path = require('node:path');

const { createJestEnvironment } = require('allure-jest/factory');

function loadNodeEnvironment() {
  try {
    return require('jest-environment-node');
  } catch (directError) {
    try {
      const jestPackagePath = require.resolve('jest/package.json');
      const jestDir = path.dirname(jestPackagePath);
      const fallbackPath = path.join(jestDir, 'node_modules', 'jest-environment-node');
      return require(fallbackPath);
    } catch (fallbackError) {
      const aggregatedError = new Error(
        'Failed to resolve jest-environment-node required by allure-jest.\n' +
        `Direct error: ${directError.message}\n` +
        `Fallback error: ${fallbackError.message}`
      );
      aggregatedError.cause = fallbackError;
      throw aggregatedError;
    }
  }
}

const NodeEnvironmentModule = loadNodeEnvironment();
const NodeEnvironment = NodeEnvironmentModule.default ?? NodeEnvironmentModule;

module.exports = createJestEnvironment(NodeEnvironment);
