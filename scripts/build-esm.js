const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src");
const distEsmDir = path.join(__dirname, "..", "dist", "esm");

// Create dist/esm directory
if (!fs.existsSync(distEsmDir)) {
  fs.mkdirSync(distEsmDir, { recursive: true });
}

// Convert CommonJS to ESM
function convertToESM(content) {
  // Replace require() with import
  content = content.replace(
    /const\s+(\{[^}]+\}|\w+)\s*=\s*require\(["'](.+?)["']\);?/g,
    (match, varName, modulePath) => {
      // Add .js extension to relative imports if not present
      if (modulePath.startsWith(".") && !modulePath.endsWith(".js")) {
        modulePath += ".js";
      }
      return `import ${varName} from "${modulePath}";`;
    }
  );

  // Replace module.exports
  content = content.replace(
    /module\.exports\s*=\s*\{([^}]+)\};?/g,
    (match, exports) => {
      // Check if exports contain property assignments like "EVENT_TYPES: schemas.EVENT_TYPES"
      const hasPropertyAssignments = /\w+:\s*\w+\.\w+/.test(exports);
      
      if (hasPropertyAssignments) {
        // Extract property assignments and create const declarations
        const lines = exports.split(',').map(line => line.trim()).filter(Boolean);
        const constDecls = lines
          .filter(line => line.includes(':'))
          .map(line => {
            const [name, value] = line.split(':').map(s => s.trim());
            return `const ${name} = ${value};`;
          })
          .join('\n');
        
        const exportNames = lines.map(line => {
          if (line.includes(':')) {
            return line.split(':')[0].trim();
          }
          return line;
        }).join(',\n  ');
        
        return `${constDecls}\n\nexport {\n  ${exportNames},\n};`;
      }
      
      return `export { ${exports.trim()} };`;
    }
  );

  // Replace module.exports = something
  content = content.replace(
    /module\.exports\s*=\s*([^;]+);?/g,
    "export default $1;"
  );

  return content;
}

// Copy and convert files
function convertFiles(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      convertFiles(srcPath, destPath);
    } else if (entry.name.endsWith(".js")) {
      const content = fs.readFileSync(srcPath, "utf-8");
      const esmContent = convertToESM(content);
      fs.writeFileSync(destPath, esmContent);
    }
  }
}

convertFiles(srcDir, distEsmDir);

// Create package.json for ESM
const esmPackageJson = {
  type: "module",
};
fs.writeFileSync(
  path.join(distEsmDir, "package.json"),
  JSON.stringify(esmPackageJson, null, 2)
);

console.log("✅ ESM build completed");
