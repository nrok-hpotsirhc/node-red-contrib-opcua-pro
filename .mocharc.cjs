// .mocharc.cjs — Mocha configuration (CommonJS, required on Windows for glob support)
module.exports = {
  recursive: true,
  timeout:   10000,
  spec:      [
    'nodes/**/*.test.js',
    'lib/**/*.test.js',
    'test/**/*.test.js'
  ]
};
