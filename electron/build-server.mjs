// 用 esbuild 把 server/index.ts + 所有依赖 bundle 成单个 CJS 文件
// 输出：build/server-bundle.cjs
// Electron main 在生产模式直接 require 它，不需要 tsx / node_modules 解析
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outFile = path.join(projectRoot, "build", "server-bundle.cjs");

fs.mkdirSync(path.dirname(outFile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(projectRoot, "server", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: outFile,
  // 这些原生模块不能 bundle，让 Node 运行时 require
  external: ["electron"],
  // 一些可选依赖如果项目没真用，就忽略
  loader: { ".node": "file" },
  banner: {
    // 让 bundle 里的 ESM import.meta 能跑（虽然 cjs 模式下用不到）
    js: "const __filename__ = '';",
  },
  logLevel: "info",
});

console.log(`✓ server bundle → ${path.relative(projectRoot, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
