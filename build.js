const esbuild = require('esbuild');
const { dtsPlugin } = require("esbuild-plugin-d.ts");
const path = require("path");
const pkg = require(path.resolve("./package.json"));

async function build(){

  // make lib js
  await esbuild.build({
    logLevel: 'info',
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: true,
    format: 'cjs',
    sourcemap: 'external',
    outfile: `dist/esbuild/index.js`,
    plugins: [
      dtsPlugin()
    ],
    external: [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]
  });
}


build().catch((e) => {
  console.error('cannot build', e);
  process.exit(1);
});

