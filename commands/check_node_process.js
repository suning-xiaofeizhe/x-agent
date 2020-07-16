'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const cmp = require('semver-compare');
const pid = process.argv[2];
const results = {};

// node version
results.pid = pid;
results.nodeVersion = process.versions.node;

const getCwd = function (filePath) {
  filePath = fs.realpathSync(filePath);
  const fileStat = fs.statSync(filePath);
  if (fileStat.isFile()) {
    return path.dirname(filePath);
  }
  return filePath;
};

// get xprofiler info
(function () {
  const platform = os.platform();
  let env = '';
  let cwd = '';
  let cmd = '';
  let dir = '/tmp';
  let exe = '';
  if (platform === 'darwin') {
    try {
      // get log dir
      env = (cp.execSync(`ps eww ${pid}`)).toString();
      const reg = /([^\s]*)=([^\s]*)/g;
      let pair;
      while ((pair = reg.exec(env)) !== null) {
        if (pair[1] === 'XNODE_LOG_DIR') {
          dir = pair[2];
        }
      }
      // get cwd
      let stdout = cp.execSync(`lsof -a -d cwd -p ${pid}| grep -E "node |iojs |PM2 "`).toString().trim();
      stdout = stdout.replace(/\s+/g, '\t');
      cwd = stdout.split('\t').pop();
      // get cmd
      cmd = cp.execSync(`ps -o command= -p ${pid} |awk '{ print $2 }'`).toString().trim();
      // get exe
      let exeStdout = cp.execSync(`lsof -a -d txt -p ${pid}| grep node`).toString().trim();
      exeStdout = exeStdout.split('\n');
      for (let i = 0; i < exeStdout.length; i++) {
        const line = exeStdout[i];
        const elements = line.replace(/\s+/g, '\t').split('\t');
        const binary = elements.pop();
        const exec = path.basename(binary);
        if (exec === 'node') {
          exe = binary;
        }
      }
    } catch (err) {
      console.error(`process ${pid} not exists`);
      return;
    }
  }
  if (platform === 'linux') {
    // get log dir
    const envPath = `/proc/${pid}/environ`;
    const cwdPath = `/proc/${pid}/cwd`;
    const exePath = `/proc/${pid}/exe`;
    if (!fs.existsSync(envPath) || !fs.existsSync(cwdPath) || !fs.existsSync(exePath)) {
      console.error(`process ${pid} not exists!`);
      return '';
    }
    env = fs.readFileSync(envPath, 'utf8');
    const lines = env.split('\u0000');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('XNODE_LOG_DIR')) {
        dir = line.split('=')[1];
      }
    }
    // get cwd
    cwd = fs.realpathSync(cwdPath);
    // get cmd
    cmd = cp.execSync(`ps -o cmd= -p ${pid} |awk '{ print $2 }'`).toString().trim();
    // get exe
    exe = exePath;
  }
  if (platform === 'win32') {
    let executable = cp.execSync(`wmic process where "processid=${pid}" get executablepath`).toString().trim();
    executable = executable.split('\r\r')[1].trim();
    exe = JSON.stringify(executable);
    let commandline = cp.execSync(`wmic process where "processid=${pid}" get commandline`).toString().trim();
    commandline = commandline.split('\r\r')[1].trim();
    commandline = commandline.replace(`"${executable}"`, '').trim();
    cmd = JSON.stringify(commandline);
    const xprofilerfile = path.join(os.homedir(), '.xprofiler');
    if (fs.existsSync(xprofilerfile)) {
      const tmpfile = fs.readFileSync(xprofilerfile, 'utf8');
      for (const line of tmpfile.split('\n')) {
        const tmp = line.split('\u0000');
        const pidtmp = tmp[0];
        if (Number(pidtmp) === Number(pid)) {
          cwd = tmp[2];
        }
      }
    }
  }

  const opts = { timeout: 1000, env: process.env };
  // get real node binary path
  if (exe) {
    const version = cp.execSync(`${exe} -v`, opts).toString().trim();
    results.nodeVersion = version.slice(1);
  }
  // check xprofiler in package.json
  if (cwd) {
    opts.cwd = cwd;
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
    try {
      cp.execSync('node -e \'require.resolve("xprofiler")\'',
        Object.assign({}, opts, { stdio: 'ignore' }));
      results.installXnode = true;
    } catch (err) {
      results.installXnode = false;
    }
    if (!results.installXnode) {
      return;
    }
    try {
      let xnodeModulePathCmd = '';
      if (os.platform() === 'win32') {
        xnodeModulePathCmd = 'node -p "path.dirname(require.resolve(\\"xprofiler\\"))"';
      } else {
        xnodeModulePathCmd = 'node -p \'path.dirname(require.resolve("xprofiler"))\'';
      }
      let xnodeModulePath = cp.execSync(xnodeModulePathCmd, Object.assign({}, opts, { stdio: [0, 'pipe', 'ignore'] }));
      xnodeModulePath = xnodeModulePath.toString().trim();
      const pkg = require(path.join(xnodeModulePath, 'package.json'));
      let xnode = '';
      if (cmp(pkg.version, '1.0.0') >= 0) {
        const xprofctl = path.join(xnodeModulePath, 'bin/xprofctl');
        xnode = cp.execSync(`node ${xprofctl} check_version -p ${pid}`, Object.assign({}, opts, { stdio: [0, 'pipe', 'ignore'] })).toString().trim();
        // get xnode logdir
        const xnodeConfig = cp.execSync(`node ${xprofctl} get_config -p ${pid}`, Object.assign({}, opts, { stdio: [0, 'pipe', 'ignore'] })).toString().trim();
        const logdir = /log_dir: (.*)\n/.exec(xnodeConfig);
        if (logdir) {
          dir = logdir[1];
        }
      } else {
        const checkXNodeVersionCmd =
          `require(path.join("${xnodeModulePath}", "lib/kill.js"))("--check_version", ${pid})`;
        xnode = cp.execSync(`node -e '${checkXNodeVersionCmd}'`,
          Object.assign({}, opts, { stdio: [0, 'pipe', 'ignore'] }));
      }
      const regexp = /(.*)(\d{1,3}\.\d{1,3}\.\d{1,3})/;
      const patt = regexp.exec(xnode.toString());
      if (patt) {
        results.xnodeVersion = patt[2];
        let xagentLogDir = process.env.logdir || '';
        if (xagentLogDir.endsWith('/')) {
          xagentLogDir = xagentLogDir.slice(0, xagentLogDir.length - 1);
        }
        if (dir.endsWith('/')) {
          dir = dir.slice(0, dir.length - 1);
        }
        results.xagentLogDir = xagentLogDir;
        results.xnodeLogDir = dir;
      }
    } catch (err) {
      results.xnodeVersion = null;
    }
  }
})();

console.log(JSON.stringify(results));