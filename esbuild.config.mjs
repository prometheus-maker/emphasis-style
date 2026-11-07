import esbuild from "esbuild";
const prod = process.argv[2] === "production";
// the plugin: one CommonJS file, Obsidian and CodeMirror provided by the app
await esbuild.build({
	entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "es2020", outfile: "main.js",
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"], sourcemap: prod ? false : "inline",
	minify: false, logLevel: "info", treeShaking: true,
});
// the pure logic as an ES module for the unit tests
await esbuild.build({ entryPoints: ["src/logic.ts"], bundle: true, format: "esm", outfile: "build/logic.mjs", logLevel: "warning" });
