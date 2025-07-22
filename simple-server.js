const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/mock-frontend.html') {
    // Serve the mock frontend
    fs.readFile(path.join(__dirname, 'mock-frontend.html'), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8080, () => {
  console.log('Simple server running on http://localhost:8080');
  console.log('Mock frontend available at: http://localhost:8080/mock-frontend.html');
});