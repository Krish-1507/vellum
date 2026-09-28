// Timing probe: can we embed chunks locally at a sane speed?
import { writeFile } from "fs/promises";
const t0 = Date.now();
const { pipeline } = await import("@huggingface/transformers");
console.log("import ms:", Date.now() - t0);
const t1 = Date.now();
const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
console.log("model load ms:", Date.now() - t1);
const t2 = Date.now();
const out = await extractor("The aggregate liability shall not exceed AED 100,000.", {
  pooling: "mean",
  normalize: true,
});
console.log("embed ms:", Date.now() - t2, "dims:", out.tolist()[0].length);
await writeFile("data/embed-probe.log", `ok load=${Date.now() - t1} embed=${Date.now() - t2}\n`);
