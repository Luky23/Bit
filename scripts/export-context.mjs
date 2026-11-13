import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outputFile = 'contexto_bit_para_claude.md';

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    // Ignore directories
    if (file === 'node_modules' || file === '.git' || file === '.venv' || file === 'dist' || file === 'out') {
      continue;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(relPath);
    }
  }
  return arrayOfFiles;
}

function shouldInclude(relPath) {
  // CRITICAL IGNORES (Rule 2)
  if (relPath === '.env') return false;
  if (relPath === outputFile) return false;
  if (
    relPath.endsWith('.lock') ||
    relPath.endsWith('.onnx') ||
    relPath.endsWith('.wav') ||
    relPath.endsWith('.mp3') ||
    relPath.endsWith('.png') ||
    relPath.endsWith('.jpg') ||
    relPath.endsWith('.ico')
  ) {
    return false;
  }
  if (relPath === 'models-catalog.json') return false;

  // INCLUDES (Rule 1)
  // 1. Node.js code (`main/**/*.mjs`, `main/**/*.js`, `scripts/**/*.mjs`, `scripts/**/*.js`)
  if (/^main\/.*\.(mjs|js)$/.test(relPath)) return true;
  if (/^scripts\/.*\.(mjs|js)$/.test(relPath)) return true;

  // 2. Python code & requirements (`main/voice-sidecar/*.py`, `requirements.txt`)
  if (/^main\/voice-sidecar\/.*\.py$/.test(relPath)) return true;
  if (relPath === 'main/voice-sidecar/requirements.txt' || relPath === 'requirements.txt') return true;

  // 3. UI files (`*.html`, `*.css`)
  if (/\.(html|css)$/.test(relPath)) return true;

  // 4. Configuration scripts (`scripts/*.ps1`, `scripts/*.bat`, `*.vbs`, `*.bat`)
  if (/\.(ps1|bat|vbs)$/.test(relPath)) return true;

  // 5. Base config (`package.json`, `main/package.json`, `.env.example`)
  if (relPath === 'package.json' || relPath === 'main/package.json' || relPath === '.env.example') return true;

  return false;
}

function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath).toLowerCase();

  if (filename === 'requirements.txt') return 'text';
  if (filename === '.env.example') return 'dotenv';

  switch (ext) {
    case '.mjs':
    case '.js':
      return 'javascript';
    case '.py':
      return 'python';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.ps1':
      return 'powershell';
    case '.bat':
      return 'bat';
    case '.vbs':
      return 'vbscript';
    default:
      return 'text';
  }
}

function generateContext() {
  const allFiles = getAllFiles(rootDir);
  const includedFiles = allFiles.filter(shouldInclude).sort();

  let markdown = '';

  for (const relPath of includedFiles) {
    const fullPath = path.join(rootDir, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lang = getLanguage(relPath);

    markdown += `### Archivo: \`${relPath}\`\n`;
    markdown += `\`\`\`${lang}\n`;
    markdown += content;
    if (!content.endsWith('\n')) {
      markdown += '\n';
    }
    markdown += `\`\`\`\n\n`;
  }

  fs.writeFileSync(path.join(rootDir, outputFile), markdown, 'utf8');
  console.log(`Exportación completada. Se incluyeron ${includedFiles.length} archivos en '${outputFile}'.`);
}

generateContext();
