// no-op Windows signer：跳过 Wine/签名，返回原路径
exports.default = async function (configuration) {
  return configuration.path;
};
