const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BUILD_TMP = path.join(ROOT_DIR, '.build_tmp');

console.log('======================================================');
console.log('🚀 RemoteAssist Pro - Professional Standalone Packager');
console.log('======================================================');

// 1. Clean & Prepare Build Directories
if (fs.existsSync(BUILD_TMP)) fs.rmSync(BUILD_TMP, { recursive: true, force: true });
fs.mkdirSync(BUILD_TMP, { recursive: true });
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// Obfuscation configuration for Commercial Protection
const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  transformObjectKeys: true,
  ignoreImports: true,
  reservedStrings: ['http', 'fs', 'path', 'os', 'child_process', 'ws']
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 2. Build Client (End-User Standalone)
console.log('\n[1/4] 🔒 Obfuscating Client Core & Assets...');
const clientTmp = path.join(BUILD_TMP, 'client');
fs.mkdirSync(clientTmp, { recursive: true });

// Copy UI assets
copyDir(path.join(SRC_DIR, 'client', 'ui'), path.join(clientTmp, 'ui'));

// Copy native bin drivers
const binTmp = path.join(clientTmp, 'bin');
fs.mkdirSync(binTmp, { recursive: true });
fs.copyFileSync(path.join(SRC_DIR, 'bin', 'RemoteCapture.exe'), path.join(binTmp, 'RemoteCapture.exe'));
fs.copyFileSync(path.join(SRC_DIR, 'bin', 'RemoteInput.exe'), path.join(binTmp, 'RemoteInput.exe'));

// Obfuscate agent JS
const clientRawJs = fs.readFileSync(path.join(SRC_DIR, 'client', 'agent_standalone.js'), 'utf8');
const clientObfuscated = JavaScriptObfuscator.obfuscate(clientRawJs, obfuscatorOptions).getObfuscatedCode();
fs.writeFileSync(path.join(clientTmp, 'index.js'), clientObfuscated, 'utf8');

// Copy node_modules ws to client tmp
copyDir(path.join(ROOT_DIR, 'node_modules', 'ws'), path.join(clientTmp, 'node_modules', 'ws'));

// Package.json for client build
fs.writeFileSync(path.join(clientTmp, 'package.json'), JSON.stringify({
  name: 'remoteassist-client',
  version: '2.0.0',
  main: 'index.js',
  bin: 'index.js',
  dependencies: {
    "ws": "^8.18.0"
  },
  pkg: {
    scripts: ['index.js'],
    assets: ['ui/**/*', 'bin/**/*']
  }
}, null, 2));

// 3. Build Host (Technician Standalone)
console.log('[2/4] 🔒 Obfuscating Host Controller & Assets...');
const hostTmp = path.join(BUILD_TMP, 'host');
fs.mkdirSync(hostTmp, { recursive: true });

// Copy UI assets
copyDir(path.join(SRC_DIR, 'host', 'ui'), path.join(hostTmp, 'ui'));

// Obfuscate host JS
const hostRawJs = fs.readFileSync(path.join(SRC_DIR, 'host', 'host_standalone.js'), 'utf8');
const hostObfuscated = JavaScriptObfuscator.obfuscate(hostRawJs, obfuscatorOptions).getObfuscatedCode();
fs.writeFileSync(path.join(hostTmp, 'index.js'), hostObfuscated, 'utf8');

// Copy node_modules ws to host tmp
copyDir(path.join(ROOT_DIR, 'node_modules', 'ws'), path.join(hostTmp, 'node_modules', 'ws'));

// Package.json for host build
fs.writeFileSync(path.join(hostTmp, 'package.json'), JSON.stringify({
  name: 'remoteassist-host',
  version: '2.0.0',
  main: 'index.js',
  bin: 'index.js',
  dependencies: {
    "ws": "^8.18.0"
  },
  pkg: {
    scripts: ['index.js'],
    assets: ['ui/**/*']
  }
}, null, 2));

// 4. Compile Standalone Binaries with PKG
console.log('[3/4] 📦 Compiling Standalone Native Windows Binaries...');

const clientTargetExe = path.join(DIST_DIR, 'RemoteAssist-Client.exe');
const hostTargetExe = path.join(DIST_DIR, 'RemoteAssist-Host.exe');

const pkgBinJs = path.join(ROOT_DIR, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');

console.log('   -> Building RemoteAssist-Client.exe ...');
execSync(`"${process.execPath}" "${pkgBinJs}" "${path.join(clientTmp, 'package.json')}" --targets node18-win-x64 --output "${clientTargetExe}"`, {
  stdio: 'inherit',
  cwd: clientTmp
});

console.log('   -> Building RemoteAssist-Host.exe ...');
execSync(`"${process.execPath}" "${pkgBinJs}" "${path.join(hostTmp, 'package.json')}" --targets node18-win-x64 --output "${hostTargetExe}"`, {
  stdio: 'inherit',
  cwd: hostTmp
});

// 5. Cleanup
console.log('\n[4/4] 🧹 Cleaning temporary build files...');
fs.rmSync(BUILD_TMP, { recursive: true, force: true });

console.log('\n======================================================');
console.log('✅ BUILD COMPLETE! Standalone Executables Generated:');
console.log('📁 Client (End-User):   ' + clientTargetExe);
console.log('📁 Host (Technician):   ' + hostTargetExe);
console.log('======================================================\n');
