const enabledNamespaces = String(process.env.DEBUG || '').split(',').map((value) => value.trim()).filter(Boolean);

function createDebug(namespace) {
  const logger = (...args) => {
    if (logger.enabled) console.error(namespace, ...args);
  };
  logger.namespace = namespace;
  logger.enabled = enabledNamespaces.includes('*') || enabledNamespaces.includes(namespace);
  logger.extend = (suffix) => createDebug(`${namespace}:${suffix}`);
  return logger;
}

createDebug.enable = (namespaces) => {
  enabledNamespaces.splice(0, enabledNamespaces.length, ...String(namespaces || '').split(',').map((value) => value.trim()).filter(Boolean));
};
createDebug.disable = () => enabledNamespaces.splice(0, enabledNamespaces.length);
createDebug.enabled = (namespace) => enabledNamespaces.includes('*') || enabledNamespaces.includes(namespace);
createDebug.coerce = (value) => value;
createDebug.formatters = {};

module.exports = createDebug;
module.exports.default = createDebug;
