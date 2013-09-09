
/**
 * Module dependencies.
 */

var url = require('url');
var net = require('net');
var tls = require('tls');
var http = require('http');
var https = require('https');
var assert = require('assert');
var Agent = require('../');

describe('"http" module', function () {
  var server;
  var port;

  // setup test HTTP server
  before(function (done) {
    server = http.createServer();
    server.listen(0, function () {
      port = server.address().port;
      done();
    });
  });

  // shut down test HTTP server
  after(function (done) {
    server.once('close', function () {
      done();
    });
    server.close();
  });

  // test subject `http.Agent` instance
  var agent = new Agent(function (req, opts, fn) {
    if (!opts.port) opts.port = 80;
    var socket = net.connect(opts);
    fn(null, socket);
  });

  it('should work for basic HTTP requests', function (done) {
    // add HTTP server "request" listener
    var gotReq = false;
    server.once('request', function (req, res) {
      gotReq = true;
      res.setHeader('X-Foo', 'bar');
      res.setHeader('X-Url', req.url);
      res.end();
    });

    var info = url.parse('http://127.0.0.1:' + port + '/foo');
    info.agent = agent;
    http.get(info, function (res) {
      assert.equal('bar', res.headers['x-foo']);
      assert.equal('/foo', res.headers['x-url']);
      assert(gotReq);
      done();
    });
  });

  it('should set the `Connection: close` response header', function (done) {
    // add HTTP server "request" listener
    var gotReq = false;
    server.once('request', function (req, res) {
      gotReq = true;
      res.setHeader('X-Url', req.url);
      assert.equal('close', req.headers.connection);
      res.end();
    });

    var info = url.parse('http://127.0.0.1:' + port + '/bar');
    info.agent = agent;
    http.get(info, function (res) {
      assert.equal('/bar', res.headers['x-url']);
      assert.equal('close', res.headers.connection);
      assert(gotReq);
      done();
    });
  });

});

describe('"https" module', function () {
});
