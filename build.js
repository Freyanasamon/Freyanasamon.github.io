// Inlines engine.js into app.src.html -> index.html (single-file, offline-capable)
const fs = require("fs"), path = require("path");
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "app.src.html"), "utf8");
const eng = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
fs.writeFileSync(path.join(dir, "index.html"), html.replace("/*ENGINE*/", () => eng));
console.log("built index.html");
