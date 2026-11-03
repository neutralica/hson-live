import { build } from "esbuild";

/** Build the matching automatic delivery pair without duplicating runtime modules. */
export async function build_scout_browser() {
  const options = { bundle: true, format: "esm", platform: "browser", target: "es2022",
    minify: true, write: false, metafile: true, legalComments: "none" };
  const bootstrap = await build({ ...options, entryPoints: ["dist/api/scout/auto.js"],
    outfile: "dist/scout-auto.js", external: ["./scout-hosted.js"] });
  const runtime = await build({ ...options, entryPoints: ["dist/api/scout/scout-hosted.js"],
    outfile: "dist/scout-hosted.js" });
  const initial = Object.values(bootstrap.metafile.outputs);
  if (bootstrap.outputFiles.length !== 1 || runtime.outputFiles.length !== 1
    || initial.length !== 1 || initial[0].imports.length !== 1
    || initial[0].imports[0].kind !== "dynamic-import" || initial[0].imports[0].path !== "./scout-hosted.js"
    || Object.values(runtime.metafile.outputs).some(output => output.imports.length)) {
    throw new Error("Scout must publish a bootstrap with one native relative import and one self-contained runtime companion.");
  }
  const initialInputs = Object.keys(bootstrap.metafile.inputs);
  if (initialInputs.some(path => !/^dist\/api\/scout\/(auto|scout\.runtime)\.js$/.test(path))) {
    throw new Error("A dependency entered Scout's lightweight static closure.");
  }
  const runtimeInputs = Object.keys(runtime.metafile.inputs);
  if (runtimeInputs.some(path => initialInputs.includes(path))) {
    throw new Error("Scout's delivery pair duplicates shared modules.");
  }
  if (runtimeInputs.some(path => /(?:node:|api\/livehost\/node|node_modules\/ws\/)/.test(path))) {
    throw new Error("Server dependencies entered the Scout browser asset.");
  }
  return { bootstrap, runtime };
}
