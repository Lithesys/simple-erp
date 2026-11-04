/* eslint-disable @typescript-eslint/no-require-imports */
const packageConfig = require("./package.json");

module.exports = {
  ...packageConfig.build,
  publish: [
    {
      provider: "github",
      owner: process.env.DESKTOP_RELEASE_OWNER || "Lithesys",
      repo: process.env.DESKTOP_RELEASE_REPO || "simple-erp",
      releaseType: "release",
    },
  ],
};
