
/**
 * Module dependencies.
 */

var url = require('url');
var http = require('http');
var assert = require('assert');
var Agent = require('../');

describe('Agent', function () {
  var server;

  // setup test HTTP server
  before(function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('X-It-Works', 'yesss');
      res.end();
    });
    server.listen(0, done);
  });

  it('should work for basic HTTP requests', function (done) {
    var port = server.address().port;
    var info = url.parse('http://127.0.0.1:' + port + '/foo');
    info.agent = new Agent();
    http.get(info, function (res) {
      assert.equal('yesss', res.headers['x-it-works']);
      done();
    });
  });

  it('should set the `Connection: close` response header', function (done) {
    var port = server.address().port;
    var info = url.parse('http://127.0.0.1:' + port + '/bar');
    info.agent = new Agent();
    http.get(info, function (res) {
      assert.equal('close', res.headers.connection);
      done();
    });
  });

  // shut down test HTTP server
  after(function (done) {
    server.once('close', done);
    server.close();
  });

});
