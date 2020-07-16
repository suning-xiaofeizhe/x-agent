'use strict';

const os = require('os');
const cp = require('child_process');
const utils = require('../lib/utils');

const ignores = [
  'check_file',
  'check_node_process',
  'check_node_processes',
  'get_node_exe',
  'get_node_processes',
  'get_os_info',
  'upload_file',
  'xkill',
  'lib/kill.js',
  'require.resolve("xprofiler")',
  'which node'
];

let cmd = '';

if (os.platform() === 'win32') {
  cmd = 'wmic process get processid,commandline| findstr /C:"node.exe" /C:"pm2" /C:"iojs"';
} else {
  cmd = 'ps -e -o pid,args | grep -E "node |iojs |PM2 " | grep -v grep';
}

let result = cp.execSync(cmd).toString();
result = result
  .trim()
  .split('\n')
  .filter(line => ignores.every(ignore => typeof line === 'string' && !line.includes(ignore)))
  .map(line => {
    const result = utils.getPidAndCmd(line);
    if (result.pid && result.command && utils.isAlive(result.pid)) {
      return `${result.pid.trim()} ${result.command.trim()}`;
    }
  })
  .filter(item => item)
  .join('\n');
console.log(result);