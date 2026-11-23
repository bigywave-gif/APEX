/** Local test fixture; never contacts the Stitch service. */
import http from 'node:http';
import fs from 'node:fs';
const [manifestFile, portFile] = process.argv.slice(2);
const files = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET') {
    const match = /^\/assets\/([^/]+)\/(screenshot\.png|screen\.html)$/.exec(url.pathname);
    const file = match && files[match[1]]?.[match[2] === 'screenshot.png' ? 'image' : 'html'];
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': match[2].endsWith('.png') ? 'image/png' : 'text/html' }); fs.createReadStream(file).pipe(response); return;
  }
  let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => {
    try {
      const rpc = JSON.parse(body), tool = rpc.params?.name, args = rpc.params?.arguments || {};
      let structuredContent;
      if (tool === 'list_screens') structuredContent = { screens: Object.keys(files).map(screenId => ({ screenId })) };
      else if (tool === 'list_design_systems') structuredContent = { systems: [] };
      else if (tool === 'get_screen' && files[String(args.name || '').split('/').at(-1)]) {
        const id = String(args.name).split('/').at(-1);
        structuredContent = { htmlCode: { name: `projects/mock/files/${id}-html` }, screenshot: { name: `projects/mock/files/${id}-image` } };
      } else if (tool === 'download_file') {
        const match = /^projects\/mock\/files\/(.+)-(html|image)$/.exec(args.name || '');
        if (!match || !files[match[1]]) throw new Error('unknown file resource');
        const bytes = fs.readFileSync(files[match[1]][match[2]]);
        structuredContent = match[2] === 'html' ? { html: bytes.toString('utf8') } : { image: bytes.toString('base64'), imageMetadata: { mimeType: 'image/png' } };
      } else throw new Error('unsupported mock tool');
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { structuredContent } }));
    } catch (error) { response.writeHead(400); response.end(error.message); }
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
