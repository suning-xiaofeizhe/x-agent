'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const cmp = require('semver-compare');

const args = process.argv.slice(2);
const pid = args[args.length - 1];
const platform = os.platform();

const getCwd = function (filePath) {
  filePath = fs.realpathSync(filePath);
  const fileStat = fs.statSync(filePath);
  if (fileStat.isFile()) {
    return path.dirname(filePath);
  }
  return filePath;
};

let cwd = '';
let cmd = '';
if (platform === 'darwin') {
  try {
    let stdout = cp.execSync(`lsof -a -d cwd -p ${pid}| grep -E "node |iojs |PM2 "`).toString().trim();
    stdout = stdout.replace(/\s+/g, '\t');
    cwd = stdout.split('\t').pop();
    cmd = cp.execSync(`ps -o command= -p ${pid} |awk '{ print $2 }'`).toString().trim();
  } catch (err) {
    console.error(`process ${pid} not exists`);
    return;
  }
}

if (platform === 'linux') {
  const cwdPath = `/proc/${pid}/cwd`;
  if (!fs.existsSync(cwdPath)) {
    console.error(`process ${pid} not exists!`);
    return '';
  }
  cwd = fs.realpathSync(cwdPath);
  cmd = cp.execSync(`ps -o cmd= -p ${pid} |awk '{ print $2 }'`).toString().trim();
}

if (platform === 'win32') {
  const tmpfile = fs.readFileSync(path.join(os.homedir(), '.xprofiler'), 'utf8');
  for (const line of tmpfile.split('\n')) {
    const cwdtmp = line.split('\u0000')[2];
    if (cwdtmp) {
      cwd = cwdtmp;
    }
  }
}

if (!cwd) {
  console.error(`get process ${pid} cwd failed!`);
  return;
}

const opts = { cwd, stdio: [0, 'pipe', 'pipe'] };
if (cmd) {
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) {
    opts.cwd = getCwd(cmd);
  } else {
    const tmp = path.join(cwd, cmd);
    if (fs.existsSync(tmp)) {
      opts.cwd = getCwd(tmp);
    }
  }
}

let xnodeModulePathCmd = '';
if (os.platform() === 'win32') {
  xnodeModulePathCmd = 'node -p "path.dirname(require.resolve(\\"xprofiler\\"))"';
} else {
  xnodeModulePathCmd = 'node -p \'path.dirname(require.resolve("xprofiler"))\'';
}
let xnodeModulePath = cp.execSync(xnodeModulePathCmd, Object.assign({}, opts, { stdio: [0, 'pipe', 'ignore'] }));
xnodeModulePath = xnodeModulePath.toString().trim();

const pkg = require(path.join(xnodeModulePath, 'package.json'));
if (cmp(pkg.version, '1.0.0') >= 0) {
  try {
    let cmd = args[0].replace('--', '');
    if (cmd === 'start_profiling') {
      cmd = 'start_cpu_profiling';
    }
    if (cmd === 'start_gc_tracing') {
      cmd = 'start_gc_profiling';
    }
    const xprofctl = path.join(xnodeModulePath, 'bin/xprofctl');
    const options = [xprofctl, cmd];
    if (args.length === 2) {
      options.push('-p');
      options.push(args[1]);
    } else {
      options.push('-p');
      options.push(args[2]);
      options.push('-t');
      options.push(args[1] * 1000);
    }
    const res = cp.spawnSync('node', options);
    const stderr = res.stderr.toString();
    if (stderr) {
      console.error(stderr);
    } else {
      let stdout = res.stdout.toString();
      if (stdout.includes('.gcprofile')) {
        stdout = stdout.replace('.gcprofile', '.gclog');
      }
      const result = stdout
        .split('\n')
        .filter(item => item)
        .map(item => item.replace(': ', '：'))
        .map(item => item.replace('GC profiling 文件路径', 'GC tracing 文件路径'))
        .reverse();
      console.log(JSON.stringify(result));
    }
  } catch (err) {
    console.error(err.message);
  }
} else {
  const xkillCmd = 'console.log(path.resolve(path.dirname(require.resolve("xprofiler")), "bin/xkill.js"))';
  try {
    const xkill = cp.execSync(`node -e '${xkillCmd}'`, opts).toString().trim();
    const res = cp.spawnSync(`${xkill}`, args);
    const stderr = res.stderr.toString();
    if (stderr) {
      console.error(stderr);
    } else {
      const stdout = res.stdout.toString();
      console.log(JSON.stringify(stdout.split('\n').filter(item => item)));
    }
  } catch (err) {
    console.error(err.message);
  }
}
