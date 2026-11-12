exports.run = async () => {
  const { app } = require("photoshop");
  const uxp = require("uxp");
  return { ps: uxp.host.version, host: uxp.host.name, uxp: uxp.versions.uxp, documents: app.documents.length };
};
