
/**
 * Module dependencies.
 */

var url = require('url');
var http = require('http');
var assert = require('assert');
var Agent = require('../');

describe('Agent', function () {

  it('should work in simple http requests', function (done) {
    // set up a local HTTP server
    var server = http.createServer(function (req, res) {
      res.setHeader('X-It-Works', 'yesss');
      res.end();
    });
    server.listen(0, function () {
      var port = server.address().port;
      var info = url.parse('http://127.0.0.1:' + port + '/foo');
      info.agent = new Agent();
      http.get(info, function (res) {
        assert.equal('yesss', res.headers['x-it-works']);
        server.on('close', done);
        server.close();
      });
    });
  });

});
