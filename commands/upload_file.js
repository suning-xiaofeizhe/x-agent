'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const urllib = require('urllib');
const formstream = require('formstream');
const tunnel = require('tunnel-agent');
const gzip = zlib.createGzip();

const argv = process.argv.slice(2);

const server = argv[0];
const token = argv[2];
const id = argv[3];
const type = argv[4];

let filepath = argv[1];
if (filepath.includes('.gclog') && !fs.existsSync(filepath)) {
  filepath = filepath.replace('.gclog', '.gcprofile');
}

// check args
if (!server || !filepath || !token || !id || !type) {
  console.error('参数错误：uploade_file server filepath token id type');
  return;
}

// check filepath
fs.stat(filepath, function (err, stat) {
  if (err) {
    console.error(`文件 ${filepath} 不存在: ${err.message}`);
    return;
  }

  if (stat.size <= 0) {
    console.error(`文件 ${filepath} 为空文件`);
    return;
  }

  // compatibility with old xnode diag report
  if (filepath.includes('.diag')) {
    let diag = fs.readFileSync(filepath, 'utf8');
    if (diag.includes('"heapSpaceStatistics":')) {
      diag = diag.replace('"heapSpaceStatistics":', '"gcStatistics":');
      fs.writeFileSync(filepath, diag);
    }
  }

  // gzip
  const gzipFile = path.join(path.dirname(filepath), `${path.basename(filepath)}.gz`);
  const gzipFileStream = fs.createWriteStream(gzipFile);
  fs.createReadStream(filepath)
    .pipe(gzip)
    .on('error', err => console.error(`压缩文件 ${filepath} 失败: ${err}`))
    .pipe(gzipFileStream)
    .on('error', err => console.error(`压缩文件 ${filepath} 失败: ${err}`))
    .on('finish', () => {
      const filepath = gzipFile;
      const form = formstream();
      const size = fs.statSync(filepath).size;
      form.file('file', filepath, filepath, size);

      const nonce = '' + (1 + parseInt((Math.random() * 100000000000), 10));
      // get signature
      const shasum = crypto.createHash('sha1');
      const timestamp = Date.now();
      shasum.update([process.env.agentid, token, nonce, id, type, timestamp].join(''));
      const sign = shasum.digest('hex');

      const url = 'http://' + server + '/file_upload_from_xagent?id=' + id +
        '&nonce=' + nonce + '&sign=' + sign + '&type=' + type + '&timestamp=' + timestamp;

      let agent = false;
      if (process.env.http_proxy) {
        const parts = process.env.http_proxy.split(':');
        agent = tunnel.httpOverHttp({
          proxy: {
            host: parts[0],
            port: parts[1]
          }
        });
      }

      const opts = {
        dataType: 'json',
        type: 'POST',
        timeout: 60000 * 20,
        headers: form.headers(),
        stream: form,
        agent: agent
      };

      urllib.request(url, opts, function (err, data, res) {
        if (err) {
          console.error(err);
          return;
        }
        if (res.statusCode !== 200) {
          console.error({ statusCode: res.statusCode, data: JSON.stringify(data) });
          return;
        }
        if (!data.ok) {
          console.error(`转储失败: ${JSON.stringify(data)}`);
          return;
        }
        console.log(JSON.stringify(data));
      });
    });
});
